import * as m from "../index.js";
const t = "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456";
console.log("in : " + t);
console.log("out: " + m.sanitizeText(t));
console.log("");
const t2 = "curl -H 'Authorization: Basic dXNlcjpwYXNzd29yZDEyMzQ1Njc4OTA='";
console.log("in2: " + t2);
console.log("out2: " + m.sanitizeText(t2));

