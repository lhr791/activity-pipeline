const fs = require('fs');
const raw = fs.readFileSync('C:/Users/xtt/.gemini/antigravity/brain/c3e534de-71f4-4763-b68f-37e7b50c6e58/.system_generated/steps/283/output.txt', 'utf8');
const parsed = JSON.parse(raw);
// Extract the untrusted data content
const match = parsed.result.match(/\[(\{[\s\S]*\})\]/);
if (!match) { console.error("No match"); process.exit(1); }
const rows = JSON.parse('[' + match[1] + ']');
const summary = JSON.parse(rows[0].summary);
fs.writeFileSync('C:/Users/xtt/Desktop/ai 施工/events.json', JSON.stringify(summary.events, null, 2), 'utf8');
console.log('Extracted', summary.events.length, 'events');
console.log('Exchanges:', [...new Set(summary.events.map(e => e.exchange))].join(', '));
