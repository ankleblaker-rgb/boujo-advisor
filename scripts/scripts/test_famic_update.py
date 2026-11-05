"""FAMIC official data -> existing private Firestore lookup. No history/catalog writes."""
import argparse,base64,csv,datetime,gzip,hashlib,io,json,re,subprocess,unicodedata,urllib.parse,urllib.request,zipfile
from html.parser import HTMLParser
PAGE='https://www.acis.famic.go.jp/ddata/index2.htm'
PROJECT='farm-ai-system'
DOCUMENT='boujo_test/ZSbRiqTgDyVBxKf4SJTN5k1KiQP2'
FILE=re.compile(r'R(\d{2})(\d{2})(\d{2})(?:_(\d{4}))?([012])\.zip$',re.I)
class Links(HTMLParser):
 def __init__(self):super().__init__();self.links=[];self.text=[]
 def handle_starttag(self,t,a):
  if t=='a':self.links.extend(v for k,v in a if k=='href')
 def handle_data(self,t):self.text.append(t)
def stamp(name):
 m=FILE.fullmatch(name)
 if not m:raise ValueError('Unsupported official filename')
 date=datetime.date(2018+int(m[1]),int(m[2]),int(m[3])).isoformat()
 return date,m[4],int(m[5])
def discover(html):
 p=Links();p.feed(html);parts={};versions=set()
 for href in p.links:
  url=urllib.parse.urljoin(PAGE,href);u=urllib.parse.urlsplit(url)
  if not FILE.fullmatch(u.path.rsplit('/',1)[-1]):continue
  if u.scheme!='https' or u.hostname!='www.acis.famic.go.jp':raise ValueError('Unexpected download host')
  date,suffix,part=stamp(u.path.rsplit('/',1)[-1]);versions.add((date,suffix))
  if part in parts and parts[part]!=url:raise ValueError('Ambiguous official links')
  parts[part]=url
 if set(parts)!={0,1,2} or len(versions)!=1:raise ValueError('Need all three files from the same release')
 date,suffix=next(iter(versions));text=' '.join(p.text)
 dates=re.findall(r'(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*登録',text)
 if not any(datetime.date(*map(int,x)).isoformat()==date for x in dates):raise ValueError('Page and filenames disagree')
 expiry=re.search(r'(\d{4})年\s*(\d{1,2})月\s*失効',text)
 return parts,date,('%s-%02d'%(expiry[1],int(expiry[2]))) if expiry else None
def fetch(url,limit):
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'BoujoAdvisor-FAMIC-Update/1.0'}),timeout=45) as r:
  if urllib.parse.urlsplit(r.url).hostname!='www.acis.famic.go.jp':raise ValueError('Unexpected redirect host')
  data=r.read(limit+1)
 if len(data)>limit:raise ValueError('Download too large')
 return data
def read_zip(data,url,part):
 with zipfile.ZipFile(io.BytesIO(data)) as z:
  files=[f for f in z.infolist() if f.filename.lower().endswith('.csv')]
  if len(files)!=1 or files[0].file_size>50*1024*1024:raise ValueError('Unexpected ZIP contents')
  expected=urllib.parse.urlsplit(url).path.rsplit('/',1)[-1][:-4]+'.csv'
  if files[0].filename!=expected:raise ValueError('ZIP and CSV names disagree')
  raw=z.read(files[0])
 try:text=raw.decode('utf-8-sig')
 except UnicodeDecodeError:text=raw.decode('cp932')
 reader=csv.DictReader(io.StringIO(text,newline=''),strict=True);headers=reader.fieldnames or []
 required=['登録番号','農薬の名称']+(['有効成分','総使用回数における有効成分','濃度','用途','剤型名','登録を有する者の名称'] if part==0 else ['作物名','適用病害虫雑草名','使用時期','希釈倍数使用量','本剤の使用回数','使用方法','散布液量'])
 if not set(required)<=set(headers) or ('作物名' in headers)!=(part!=0):raise ValueError('CSV columns do not match part')
 rows=list(reader)
 if not rows or any(None in r or any(v is None for v in r.values()) for r in rows):raise ValueError('Invalid CSV rows')
 return rows
wide=lambda s:unicodedata.normalize('NFKC',s or '')
def relevant(c):return wide(c) in ['ねぎ','小ねぎ','葉ねぎ'] or re.match(r'^(ねぎ\(|野菜類|鱗茎類|作物一般)',wide(c))
def build(tables,date,expiry,fingerprint):
 products={}
 for r in tables[0]:
  number=r['登録番号']
  if not re.fullmatch(r'\d+',number):raise ValueError('Invalid registration number')
  p=products.setdefault(number,dict(id=number,name=wide(r['農薬の名称']),company=wide(r['登録を有する者の名称']),category=r['用途'],form=wide(r['剤型名']),ingredients=[],totalNames=[],uses=[]))
  ingredient=wide(r['有効成分'])+' '+r['濃度']
  if ingredient not in p['ingredients']:p['ingredients'].append(ingredient);p['totalNames'].append(wide(r['総使用回数における有効成分'] or r['有効成分']))
 for r in tables[1]+tables[2]:
  if not relevant(r['作物名']):continue
  p=products.get(r['登録番号'])
  if p is None:raise ValueError('Usage row missing basic product')
  total=[]
  for i,n in enumerate('①②③④⑤'):
   value=r.get('有効成分'+n+'を含む農薬の総使用回数','')
   if value:total.append((p['totalNames'][i] if i<len(p['totalNames']) else '成分'+str(i+1))+'：'+value)
  u=dict(crop=r['作物名'],target=wide(r['適用病害虫雑草名']),timing=r['使用時期'],dilution=r['希釈倍数使用量'],volume=r['散布液量'],method=r['使用方法'],place=r.get('適用場所',''),count=r['本剤の使用回数'],total='\n'.join(total),restrictions='／'.join(k+'：'+r[k] for k in ['使用目的','適用土壌','適用地帯名','適用農薬名','くん蒸時間','くん蒸温度'] if r.get(k)))
  if u not in p['uses']:p['uses'].append(u)
 if len(products)<100 or not any(p['uses'] for p in products.values()):raise ValueError('Unexpected empty/small dataset')
 return dict(version=1,date=date,imported=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date().isoformat(),products=list(products.values()),source=dict(automatic=True,page=PAGE,expirationMonth=expiry,zipFingerprint=fingerprint))
def pack(db):
 raw=json.dumps(db,ensure_ascii=False,separators=(',',':')).encode()
 if len(raw)>20*1024*1024:raise ValueError('Lookup too large')
 return dict(encoding='gzip-base64',data=base64.b64encode(gzip.compress(raw,mtime=0)).decode(),digest=hashlib.sha256(raw).hexdigest(),date=db['date'],count=len(db['products']),sourceFingerprint=db['source']['zipFingerprint'])
def field(v):
 if isinstance(v,dict):return {'mapValue':{'fields':{k:field(x) for k,x in v.items()}}}
 if isinstance(v,int):return {'integerValue':str(v)}
 return {'stringValue':v}
def unfield(v):
 if 'mapValue' in v:return {k:unfield(x) for k,x in v['mapValue'].get('fields',{}).items()}
 if 'integerValue' in v:return int(v['integerValue'])
 return v.get('stringValue')
def request_json(url,token,method='GET',body=None):
 data=None if body is None else json.dumps(body,separators=(',',':')).encode()
 req=urllib.request.Request(url,data=data,method=method,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=45) as r:return json.load(r)
def publish(db,packed,token):
 base=f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/{DOCUMENT}'
 current=request_json(base,token);fields=current.get('fields',{})
 if (unfield(fields.get('minClientVersion',{})) or 0)>6:raise ValueError('Unsupported future cloud schema')
 if 'catalogJson' not in fields or 'records' not in fields:raise ValueError('Shared app must be initialized first')
 existing=unfield(fields.get('lookup',{})) or {}
 if existing.get('date','')>db['date']:raise ValueError('Refusing downgrade')
 if existing.get('sourceFingerprint')==packed['sourceFingerprint']:return 'unchanged'
 newfields={**fields,'lookup':field(packed)}
 if len(json.dumps(newfields,ensure_ascii=False).encode())>850000:raise ValueError('Cloud document too large; old lookup retained')
 query=urllib.parse.urlencode({'updateMask.fieldPaths':'lookup','currentDocument.updateTime':current['updateTime']})
 request_json(base+'?'+query,token,'PATCH',{'fields':{'lookup':field(packed)}})
 return 'updated'
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--publish',action='store_true');args=parser.parse_args()
 html=fetch(PAGE,2*1024*1024).decode('utf-8');parts,date,expiry=discover(html);tables={};hashes=[]
 for i in range(3):
  raw=fetch(parts[i],2*1024*1024);tables[i]=read_zip(raw,parts[i],i);hashes.append(hashlib.sha256(raw).hexdigest())
 fingerprint=hashlib.sha256(json.dumps([date,expiry,hashes]).encode()).hexdigest();db=build(tables,date,expiry,fingerprint);packed=pack(db)
 result='validated-only'
 if args.publish:
  token=subprocess.run(['gcloud','auth','print-access-token'],check=True,capture_output=True,text=True).stdout.strip()
  if not token:raise ValueError('Missing OAuth token')
  result=publish(db,packed,token)
 print(json.dumps({'status':result,'registration_date':date,'expiration_month':expiry,'products':len(db['products']),'lookup_bytes':len(json.dumps(packed).encode()),'source_fingerprint':fingerprint},ensure_ascii=False))
if __name__=='__main__':main()
