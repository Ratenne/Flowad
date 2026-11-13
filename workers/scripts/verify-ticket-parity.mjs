import assert from 'node:assert/strict';
const origins=['http://127.0.0.1:18081','http://127.0.0.1:18787'];
const body={latitude:37.5665,longitude:126.978,availableMinutes:180,scenery:'forest',vehicleType:'ev'};
async function post(origin,path,body){const r=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();}
for(const [source,target]of [[0,1],[1,0]]){
  const recommendation=await post(origins[source],'/api/recommendations',body),course=recommendation.courses[0];
  const resolved=await post(origins[target],'/api/navigation/resolve',{ticket:course.navigationTicket});
  assert.equal(resolved.courseId,course.id);assert.deepEqual(resolved.route,{points:course.route.points,status:course.route.status});
}
console.log('LOCAL_TEST_PASSED: Java-issued ticket resolves in Workers; Workers-issued ticket resolves in Java. Loopback and public test key only.');
