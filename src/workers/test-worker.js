// test-worker.js
console.log("Test Worker: Loading...");
self.onmessage = (e) => {
    console.log("Test Worker: Received", e.data);
    self.postMessage({ type: 'PONG' });
};
self.postMessage({ type: 'STATUS', payload: 'READY' });
