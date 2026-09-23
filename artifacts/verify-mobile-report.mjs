import { chromium } from '../app/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
const browser = await chromium.launch();
const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:5180');await page.evaluate(()=>document.fonts.ready);
await page.locator('img[src]').evaluateAll(async imgs=>{for(const img of imgs)img.loading='eager';await Promise.all(imgs.map(img=>img.decode()));});
assert.equal(await page.locator('.comparison').count(),20);
assert.equal(await page.locator('.shot img').count(),40);
await page.screenshot({path:'artifacts/report-desktop.png'});
await page.locator('#view-ai-working').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/report-comparison-desktop.png'});
await page.selectOption('#area','AI');assert.equal(await page.locator('.comparison:visible').count(),8);
await page.getByRole('button',{name:'After',exact:true}).click();assert.equal(await page.locator('.comparison:visible .before:visible').count(),0);
await page.locator('.comparison:visible .shot:visible').first().click();assert(await page.locator('#lightbox').isVisible());await page.keyboard.press('Escape');assert(!(await page.locator('#lightbox').isVisible()));
await page.getByRole('button',{name:'Both',exact:true}).click();await page.selectOption('#area','All');
await page.locator('#demo [data-action="analyze"]').click();await page.locator('[data-action="stop"]').click();assert(await page.getByText('Stopped. Your draft is still here.',{exact:true}).isVisible());
await page.locator('[data-action="analyze"]').click();await page.locator('#demo-correction').waitFor();await page.locator('#demo-correction').fill('I ate half');await page.locator('[data-action="correct"]').click();await page.locator('#demo-correction').waitFor();assert(await page.getByText('320 kcal',{exact:true}).isVisible());await page.locator('[data-action="save"]').click();assert(await page.locator('[data-action="undo"]').isVisible());await page.locator('[data-action="undo"]').click();assert(await page.locator('#demo-correction').isVisible());
await page.locator('#demo-error').click();await page.locator('[data-action="retry"]').click();await page.locator('#demo-correction').waitFor();
await page.locator('#demo-reset').click();
for(const width of [320,375,390,430,768,1280,1440]){
 await page.setViewportSize({width,height:844});await page.evaluate(()=>window.scrollTo(0,0));
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);assert(!overflow,`overflow at ${width}`);
 if(width===390){await page.screenshot({path:'artifacts/report-mobile.png'});await page.locator('#view-ai-working').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/report-comparison-mobile.png'});await page.locator('#demo').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/report-demo-mobile.png'});}
}
assert.deepEqual(errors,[]);
console.log('PASS: 40 images load; 20 comparisons; filters/toggle/zoom/Escape; AI demo stop/review/correct/save/undo/error/retry; 7 widths without document overflow; no page errors.');
await browser.close();
