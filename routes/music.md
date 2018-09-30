/*
SELECT *,id,array FROM tableName
SELECT SQL_CALC_FOUND_ROWS *,id,array FROM tableName
INSERT INTO tableName SET created = NOW(), modified = NOW()
UPDATE tableName SET name='Khen' WHERE id=1
DELETE FROM tableName WHERE id=1
WHERE
ORDER BY columnName ASC|DESC, columnName ASC|DESC;
ORDER BY columnName;
ORDERS LIMIT 10 OFFSET 15
ORDERS LIMIT 15, 10
OFFSET 4

GROUP BY UNIQUEID ORDER BY _matches DESC LIMIT 12 OFFSET 0
*/

// function delay(){
//   return new Promise(resolve => setTimeout(resolve,0));
//   // return new Promise();
// }
// var o = {};
// async function delayedLog(item){
//   await delay();
//   o[item]='ssss';
//   // console.log(item);
//   // o.push(item);
// }
// async function processArray(arr) {
//   // arr.forEach(async (item)=>{
//   //   await delayedLog(item);
//   // });
//   for( const item of arr){
//      await delayedLog(item);
//   }
//   console.log('Done',o);
//   callback(o);
// }
// processArray([1,2,4]);


async function asyncPromise(row,Id){
  // await new Promise(resolve => setTimeout(resolve,0));
}
async function asyncEach(raw) {
  for(const row of raw){
     await asyncPromise(row,Id);
  }
  callback();
}