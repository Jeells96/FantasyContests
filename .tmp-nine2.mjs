import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true })).newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await p.evaluate(() => {
  localStorage.setItem('fantasycontests.device.v1', '8feaff05f25b4817ab306dd21d09765a');
  localStorage.setItem('fantasycontests.identity.v1', JSON.stringify({ firstName: 'Jaren', lastName: 'Eells', displayName: 'Jaren Eells', savedAt: new Date().toISOString() }));
});
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(12000);
const href = await p.evaluate(() => [...document.querySelectorAll('.grid--contests .card')].map((c) => c.querySelector('a')?.getAttribute('href') + '::' + c.innerText.split('\n')[0]));
console.log(href);
const nine = href.find((h) => h.includes('Wild Card'));
await p.goto('http://localhost:4173' + nine.split('::')[0], { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(25000);
console.log('body sample:', (await p.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').slice(0, 700));
await b.close();
