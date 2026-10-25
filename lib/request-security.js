import { isIP } from 'node:net';
export function trustedProxyPolicy(value = '') {
  if (!value.trim()) return false; // Never trust arbitrary forwarding headers by default.
  const entries = value.split(',').map(s => s.trim());
  for (const entry of entries) {
    const [ip, bits, extra] = entry.split('/');
    const version = isIP(ip);
    if (!version || extra !== undefined || (bits !== undefined && (!/^\d+$/.test(bits) || Number(bits) < 1 || Number(bits) > (version === 4 ? 32 : 128)))) throw new Error('TRUSTED_PROXY_CIDRS must contain explicit trusted proxy IPs/CIDRs, not hop counts or wildcard ranges');
  }
  return entries;
}
export const sensitiveRules = [
  { prefix:'/api/repairs',max:60 }, { prefix:'/api/bids',max:40 },
  { prefix:'/api/signup',max:20 }, { prefix:'/api/send-otp',max:10 },
  { prefix:'/api/owner-request',max:20 }, { prefix:'/api/billing',max:30 },
  { prefix:'/api/provider',max:40 }, { prefix:'/api/admin',max:60 },
  { prefix:'/admin',max:60 }, { prefix:'/api/feedbacks',max:40 },
  { prefix:'/api/notifications',max:90 }
];
export function createRateLimiter({rules=sensitiveRules,windowMs=60000,maxEntries=10000,clock=Date.now}={}) {
  const hits=new Map();
  function middleware(req,res,next) {
    const path=req.path.toLowerCase();
    const rule=rules.find(r=>path===r.prefix||path.startsWith(r.prefix+'/'));
    if(!rule || req.method==='OPTIONS') return next();
    const now=clock();
    // Fixed windows share one TTL; insertion order is expiration order.
    for(const [key,hit] of hits) { if(hit.resetAt>now) break; hits.delete(key); }
    const key=rule.prefix+':'+(req.ip||req.socket?.remoteAddress||'unknown');
    let hit=hits.get(key);
    if(!hit) {
      // Do not evict live clients and let attackers reset their budget.
      if(hits.size>=maxEntries) { res.setHeader('Retry-After',String(Math.max(1,Math.ceil((hits.values().next().value.resetAt-now)/1000)))); return res.status(429).json({error:'Request capacity reached. Please retry shortly.'}); }
      hit={count:0,resetAt:now+windowMs};hits.set(key,hit);
    }
    hit.count++;
    if(hit.count>rule.max) {res.setHeader('Retry-After',String(Math.max(1,Math.ceil((hit.resetAt-now)/1000))));return res.status(429).json({error:'Too many requests. Please try again shortly.'});}
    next();
  }
  middleware.entryCount=()=>hits.size;
  return middleware;
}
export function boundedText(value,min,max) {
  return typeof value==='string' && value.trim().length>=min && value.length<=max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
}
const categories=new Set(['brakes','engine','tire replacement','tires','tire_replacement','transmission','electrical','diagnostics','suspension','a/c & heating','ac','oil change / maintenance','oil_change','battery / starter / alternator','battery','other']);
const states=new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC AS GU MP PR VI'.split(' '));
export function repairValidationError(body={},year=new Date().getUTCFullYear()) {
  for(const [key,min,max] of [['title',3,160],['issueDetails',10,10000],['vehicleMake',1,80],['vehicleModel',1,100],['city',1,100]]) if(!boundedText(body[key],min,max)) return 'Invalid '+key+'. Check text length and format.';
  const symptoms=body.issueDetails.replace(/\[(OWNER_META|CLIENT_META)\][\s\S]*?\[\/\1\]/g,'').replace(/\[Parts preference:[^\]]*\]/g,'').trim();
  if(symptoms.length<10) return 'Describe the symptoms in at least 10 characters.';
  if(typeof body.issueCategory!=='string'||!categories.has(body.issueCategory.trim().toLowerCase())) return 'Choose a supported repair category.';
  if(typeof body.vehicleYear!=='string'||!/^\d{4}$/.test(body.vehicleYear)||Number(body.vehicleYear)<1886||Number(body.vehicleYear)>year+1) return 'Enter a valid vehicle year.';
  if(typeof body.state!=='string'||!states.has(body.state.toUpperCase())) return 'Use a two-letter state code.';
  if(typeof body.zip!=='string'||!/^\d{5}$/.test(body.zip)) return 'Enter a five-digit ZIP.';
  if(body.urgency!==undefined&&!['Standard','Urgent','Emergency'].includes(body.urgency)) return 'Choose a supported urgency.';
  return null;
}
