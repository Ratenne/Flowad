import assert from 'node:assert/strict';
import {requestRoadVerification,roadRetryMessage} from '../dist/navigation-readiness.js';
const input={ticket:'test-ticket',vehicleType:'ice'};
const signal=new AbortController().signal;
const responses=[
 Response.json({error:'ROAD_PROVIDER_RATE_LIMIT'},{status:503,headers:{'Retry-After':'30'}}),
 Response.json({roadVerified:true,navigationTicket:'verified-ticket'})
];
let calls=0;
const fetcher=async(path,options)=>{
 assert.equal(path,'./api/navigation/verify');
 assert.equal(options.signal,signal);
 assert.deepEqual(JSON.parse(options.body),input);
 return responses[calls++];
};
await assert.rejects(requestRoadVerification(input,{fetcher,signal}),{message:'ROAD_PROVIDER_RATE_LIMIT',retryAfterSeconds:30});
assert.equal(calls,1);
assert.equal(roadRetryMessage(31000,1500),' 30초 후 다시 시도할 수 있어요.');
assert.equal(roadRetryMessage(31000,31000),'');
assert.equal((await requestRoadVerification(input,{fetcher,signal})).navigationTicket,'verified-ticket');
assert.equal(calls,2);
console.log('PASS: direct selected-route verification, explicit retry and remaining wait time.');
