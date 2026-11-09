// Legacy multipart uploader is retired: only durable, verified delivery is supported.
import {runDelivery} from './delivery-worker.mjs';
runDelivery().catch(()=>{console.error('Durable delivery stopped; check outbox and credentials.');process.exitCode=1;});
