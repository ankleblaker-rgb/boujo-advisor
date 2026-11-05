import unittest,io,zipfile,json,gzip,base64,hashlib,copy
from unittest.mock import patch
import famic_update as f
class Checks(unittest.TestCase):
 def test_links(self):
  links='2026年10月29日登録及び2026年10月失効反映分'+''.join(f'<a href="datacsv/R081029_1101{i}.zip">x</a>' for i in range(3))
  p,d,e=f.discover(links);self.assertEqual((d,e),('2026-10-29','2026-10'))
  with self.assertRaises(ValueError):f.discover(links.replace('R081029_11012','R0810212'))
  with self.assertRaises(ValueError):f.discover(links.replace('datacsv/R081029_11010','https://evil.test/R081029_11010'))
  with self.assertRaises(ValueError):f.discover(links.replace('2026年10月29日','2026年10月28日'))
 def test_archive(self):
  with self.assertRaises(zipfile.BadZipFile):f.read_zip(b'broken','https://www.acis.famic.go.jp/ddata/datacsv/R081029_11010.zip',0)
  b=io.BytesIO()
  with zipfile.ZipFile(b,'w') as z:z.writestr('wrong.csv','登録番号,農薬の名称\n1,a')
  with self.assertRaises(ValueError):f.read_zip(b.getvalue(),'https://www.acis.famic.go.jp/ddata/datacsv/R081029_11010.zip',0)
 def fixture(self):
  rows=[{'登録番号':str(i),'農薬の名称':'試験剤'+str(i),'登録を有する者の名称':'試験','用途':'殺虫剤','剤型名':'水和剤','有効成分':'成分A','濃度':'1%','総使用回数における有効成分':'合算成分A'} for i in range(100)]
  u={'登録番号':'1','作物名':'ねぎ','適用病害虫雑草名':'対象','使用時期':'収穫3日前まで','希釈倍数使用量':'1000倍','散布液量':'100L','本剤の使用回数':'3回以内','使用方法':'散布','有効成分①を含む農薬の総使用回数':'3回以内'}
  return f.build({0:rows,1:[u],2:[u]},'2026-10-29','2026-10','fingerprint')
 def test_lookup(self):
  db=self.fixture();self.assertEqual(len(db['products']),100);p=db['products'][1];self.assertEqual(len(p['uses']),1);self.assertEqual(p['uses'][0]['total'],'合算成分A：3回以内');self.assertEqual(p['uses'][0]['timing'],'収穫3日前まで')
  packed=f.pack(db);raw=gzip.decompress(base64.b64decode(packed['data']));self.assertEqual(hashlib.sha256(raw).hexdigest(),packed['digest']);self.assertEqual(json.loads(raw),db)
 def test_atomic_lookup_only_write(self):
  db=self.fixture();packed=f.pack(db);existing={'updateTime':'2026-11-05T00:00:00Z','fields':{'catalogJson':f.field('UNCHANGED'),'records':{'arrayValue':{'values':[]}},'lookup':f.field({'date':'2026-10-21'})}}
  original=copy.deepcopy(existing);calls=[]
  def request(url,token,method='GET',body=None):calls.append((url,method,body));return copy.deepcopy(existing) if method=='GET' else {}
  with patch.object(f,'request_json',request):self.assertEqual(f.publish(db,packed,'never-log-test-token'),'updated')
  self.assertEqual(existing,original);self.assertEqual(len(calls),2);self.assertEqual(set(calls[1][2]['fields']),{'lookup'});self.assertIn('currentDocument.updateTime=',calls[1][0]);self.assertIn('updateMask.fieldPaths=lookup',calls[1][0])
  existing['fields']['lookup']=f.field(packed);calls.clear()
  with patch.object(f,'request_json',request):self.assertEqual(f.publish(db,packed,'x'),'unchanged')
  self.assertEqual(len(calls),1)
  existing['fields']['lookup']=f.field({'date':'2026-11-10'});calls.clear()
  with patch.object(f,'request_json',request):
   with self.assertRaises(ValueError):f.publish(db,packed,'x')
  self.assertEqual(len(calls),1)
if __name__=='__main__':unittest.main()
