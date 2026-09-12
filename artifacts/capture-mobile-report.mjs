import { chromium } from '../app/node_modules/playwright-core/index.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const out = resolve('artifacts/mobile-ux-report/assets')
mkdirSync(out, {recursive:true})
const browser = await chromium.launch()
const manifest = []
const scenarios = ['home','fuel','food-entry','ai-working','ai-question','ai-review','ai-error','food-saved','food-edit','empty-workout','workout','rest-away','routine-editor','scanner','machine-unknown','machine-guide','program','settings','weight-saved','summary']
const only = process.env.SCENARIOS?.split(',')
for (const version of ['before','after']) {
  const base = version === 'before' ? 'http://127.0.0.1:5174/' : 'http://localhost:5173/'
  for (const scenario of scenarios.filter(s=>!only || only.includes(s))) {
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',timezoneId:'America/New_York'})
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    page.on('dialog', d=>d.dismiss())
    // Screenshot fixtures use no real account, proxy, food history, or API key.
    await context.route('https://ai.report.test/**', async route => {
      const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}
      if(route.request().method()==='OPTIONS') return route.fulfill({headers,status:204})
      if(route.request().method()==='GET') return route.fulfill({headers,json:{data:[]}})
      if(scenario==='ai-working') await new Promise(r=>setTimeout(r,4000))
      if(scenario==='ai-error') return route.fulfill({headers,status:401,json:{error:'Demo authorization error'}})
      const body=route.request().postDataJSON()
      const system=body.messages[0].content
      const content=system.includes('starter program') ? {sets:3,reps:12,startWeightLb:50,restSeconds:75,effortCheck:'The last two reps should feel challenging with good form.',progression:'Complete all three sets comfortably, then add one small plate.',warmup:'Start with one lighter set.'}
        : system.includes('gym machines') ? {identified:true,manufacturer:'Life Fitness',modelName:'Dual Fly',confidence:'medium',exerciseIds:['ex-pec-fly','ex-rear-delt-fly'],muscleGroups:['chest','shoulders'],setupTips:'Set the seat so the handles are level with your shoulders.',howTo:['Keep your chest supported.','Use a controlled motion.']}
        : {items:[{name:'Chicken bowl',calories:640,protein:50,carbs:65,fat:20}],...(scenario==='ai-question'?{question:{text:'How much of the bowl did you eat?',options:['All of it','Half','About three quarters']}}:{})}
      await route.fulfill({headers,json:{choices:[{message:{content:JSON.stringify(content)}}]}}).catch(()=>{})
    })
    // Thumbnails are irrelevant to these comparisons; avoid outside network noise.
    await context.route(/https:\/\/(?:i\.ytimg\.com|www\.youtube.*)\/.*/,r=>r.abort())
    const tab=async name=>{await page.locator('.tabbar .tab',{hasText:name}).click();await page.waitForTimeout(150)}
    const focus=async locator=>{await locator.first().evaluate(el=>{const sc=document.querySelector('.screen');sc.scrollTop+=el.getBoundingClientRect().top-sc.getBoundingClientRect().top-20});await page.waitForTimeout(100)}
    const composer=()=>page.locator('textarea.text-in').first().locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," card ")][1]')
    try {
      await page.goto(base)
      await page.getByText('Start Workout',{exact:false}).waitFor()
      await page.evaluate(async scenario=>{
        const {default:api}=await import('/src/data/index.ts')
        const settings=await api.getSettings()
        await api.saveSettings({...settings,aiEndpoint:'https://ai.report.test',aiApiKey:undefined,aiModel:'demo-model',experience:'new',goal:'general'})
        if(['workout','rest-away'].includes(scenario)) {
          const w=await api.startWorkout('r-legs')
          // Match the installed routine id instead of relying on seed id conventions.
          await api.cancelWorkout(w.id)
          const routines=await api.listRoutines(); const legs=routines.find(r=>r.name==='Legs')
          await api.startWorkout(legs?.id)
        }
        if(['machine-guide','program'].includes(scenario)) {
          await api.saveMachine({id:'report-machine',nickname:'Dual fly station',exerciseId:'ex-pec-fly',exerciseIds:['ex-pec-fly','ex-rear-delt-fly'],qrUrl:'https://example.test/report-machine',favorite:true})
          await api.saveMachineAiInfo({id:'example.test/report-machine',qrUrl:'https://example.test/report-machine',identified:true,manufacturer:'Life Fitness',modelName:'Dual Fly',confidence:'medium',muscleGroups:['chest','shoulders'],exerciseId:'ex-pec-fly',exerciseIds:['ex-pec-fly','ex-rear-delt-fly'],setupTips:'Set the seat so the handles are level with your shoulders.',howTo:['Keep your chest supported.','Use a controlled motion.'],createdAt:Date.now()})
          if(scenario==='program') await api.saveAiProgram({id:'report-machine::ex-pec-fly',exerciseId:'ex-pec-fly',sets:3,reps:12,startWeightLb:50,restSeconds:75,effortCheck:'The last two reps should feel challenging with good form.',progression:'Complete all three sets comfortably, then add one small plate.',warmup:'Start with one lighter set.',createdAt:Date.now()})
        }
      },scenario)
      await page.reload();await page.getByText(/Start Workout|Resume Workout/).first().waitFor()
      if(['fuel','food-entry','ai-working','ai-question','ai-review','ai-error','food-saved','food-edit'].includes(scenario)) {
        await tab('Fuel')
        if(scenario==='food-saved'||scenario==='food-edit') {
          await page.getByRole('button',{name:/Protein shake/i}).click()
          await page.getByText('340 kcal · 48P').waitFor()
          if(scenario==='food-saved') await focus(page.locator('.meal-row').filter({hasText:'Protein shake'}))
          else {await page.locator('[title="Tap to edit"]',{hasText:'Protein shake'}).click();await focus(page.locator('.field').filter({hasText:'Food'}))}
        } else if(scenario!=='fuel') {
          await page.getByText('＋ Quick add',{exact:false}).click()
          await page.locator('textarea.text-in').fill('A chicken bowl with rice and vegetables')
          if(scenario==='food-entry') await focus(composer())
          else {
            await page.getByRole('button',{name:'Analyze with AI',exact:true}).click()
            if(scenario==='ai-working') {await page.waitForTimeout(1000);await focus(composer())}
            else if(scenario==='ai-error') {await page.getByText(/AI proxy rejected/).waitFor();await focus(composer())}
            else {await page.getByText('AI estimate — review',{exact:false}).waitFor();await focus(page.locator('.card').filter({hasText:'AI estimate — review'}))}
          }
        }
      }
      if(['empty-workout','workout','rest-away','routine-editor','summary'].includes(scenario)) {
        await tab('Train')
        if(scenario==='routine-editor') {await page.locator('button[title="Edit routine"]').first().click();await page.getByText('Sets × target reps per exercise.',{exact:false}).count();await page.waitForTimeout(200)}
        else {
          if(scenario==='empty-workout') await page.getByText('＋ Start empty workout',{exact:true}).click()
          else if(scenario==='summary') {await page.getByText('🦵 Legs',{exact:true}).click()}
          if(scenario!=='empty-workout') {
            await page.locator('.set-row input').first().fill('90')
            await page.locator('.set-row input').nth(1).fill('12')
            await page.locator('.set-row .set-done-btn').first().click()
            await page.locator('.rest-toast').waitFor()
            if(scenario==='rest-away') await tab('Fuel')
            if(scenario==='summary') {
              await page.locator('.rest-toast').getByRole('button',{name:'Skip',exact:true}).click()
              await page.getByText('Finish workout',{exact:false}).click()
              await page.getByText('Workout complete',{exact:true}).waitFor()
              await page.locator('textarea').fill('Good session. Keep the same weight next time.')
              await page.getByRole('button',{name:'Save note',exact:true}).click()
              await page.getByRole('button',{name:'Saved ✓',exact:true}).waitFor()
            }
          }
        }
      }
      if(['scanner','machine-unknown','machine-guide','program'].includes(scenario)) {
        await page.locator('.tabbar .scan-key').click()
        if(scenario==='scanner') await page.waitForTimeout(700)
        else {
          await page.locator('.text-in').fill(scenario==='machine-unknown'?'https://example.test/unrecognized':'https://example.test/report-machine')
          await page.getByRole('button',{name:'Go',exact:true}).click()
          if(scenario==='machine-unknown') {await page.getByText('Save my machine',{exact:false}).waitFor();await focus(page.locator('.ghost-btn').filter({hasText:'Ask AI'}))}
          if(scenario==='machine-guide') {await page.getByText('✦ AI guide',{exact:true}).waitFor();await focus(page.locator('.card').filter({hasText:'✦ AI guide'}))}
          if(scenario==='program') {await page.getByText('✦ Your starter program',{exact:true}).waitFor();await focus(page.locator('.card').filter({hasText:'✦ Your starter program'}));if(version==='after')await page.getByLabel('Adjust your program').fill('The starting weight feels too heavy.')}
        }
      }
      if(scenario==='settings') {
        await page.locator('.page .icon-btn[title="Settings"]').click()
        await page.locator('.card').filter({hasText:'✦ AI assist'}).getByRole('button',{name:'Test & save',exact:true}).click()
        await page.getByText('Connected ✓',{exact:true}).waitFor()
        await focus(page.locator('.card').filter({hasText:'✦ AI assist'}))
      }
      if(scenario==='weight-saved') {
        await tab('Stats')
        await page.getByPlaceholder('182.4').fill('182.4')
        await page.getByRole('button',{name:'Log',exact:true}).click()
        await page.getByText('182.4 lb',{exact:false}).waitFor()
        await focus(page.getByPlaceholder('182.4').locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," card ")][1]'))
      }
      await page.waitForTimeout(150)
      const file=`${version}-${scenario}.png`
      await page.screenshot({path:`${out}/${file}`})
      manifest.push({version,scenario,file,width:390,height:844,source:version==='before'?'baseline 00f64ed':'working tree',fixture:'sample data; mocked AI'})
      console.log(`CAPTURED ${version} ${scenario}`)
    } catch(error) {
      await page.screenshot({path:`${out}/debug-${version}-${scenario}.png`})
      console.error(`FAILED ${version} ${scenario}: ${error.message}`)
    } finally {await context.close()}
  }
}
writeFileSync(resolve('artifacts/capture-manifest.json'),JSON.stringify(manifest,null,2))
await browser.close()
