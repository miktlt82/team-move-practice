import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/index.js';

describe('Сценарии портала', () => {
  let server;
  let origin;
  let employee;
  let colleague;
  let admin;
  let orderId;
  const deliveries = [];
  const note = 'Выполнил задание и записал результат для проверки.';
  const secret = 'test-secret';
  async function send(path, cookie, method = 'GET', body, headers = {}) {
    const response = await fetch(origin + '/api' + path, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = response.status === 204 ? null : await response.json();
    return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function get(path, cookie, method, body, status = 200) {
    const response = await send(path, cookie, method, body);
    assert.equal(response.status, status, JSON.stringify(response.data));
    return response.data;
  }
  const balance = async cookie => (await get('/me/dashboard', cookie)).balance;
  before(async () => {
    server = createApp({ demo: true, telegramConfig: { token:'unused-test-token',username:'example_test_bot',secret,
      transport: async (_, request) => { deliveries.push(JSON.parse(request.body)); return Response.json({ok:true}); } } });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = 'http://127.0.0.1:' + server.address().port;
    const login = async (email, password) => {
      const response = await send('/auth/login', null,'POST',{email,password});
      assert.equal(response.status,200);
      return response.cookie;
    };
    employee = await login('employee@example.test', 'EmployeeDemo!2026');
    colleague = await login('ira@example.test', 'EmployeeDemo!2026');
    admin = await login('admin@example.test', 'AdminDemo!2026');
  });
  after(async () => {
    server.close();
    await once(server,'close');
  });

  it('locks quest steps, awards a challenge once, finishes onboarding and exposes public achievements', async () => {
    assert.equal((await send('/cart')).status,401);
    assert.equal((await send('/admin/challenges',employee)).status,403);
    assert.equal((await send('/wheel',admin)).status,403);
    const list = await get('/challenges',employee);
    assert.ok(list.items.some(row => row.status === 'ended'));
    const first = list.items.find(row => row.mode === 'individual' && row.status === 'open');
    const team = list.items.find(row => row.mode === 'team' && row.status === 'open');
    await get('/challenges/'+first.id+'/join',employee,'POST');
    await get('/challenges/'+team.id+'/join',employee,'POST');
    await get('/challenges/'+team.id+'/join',colleague,'POST');
    let quest = await get('/onboarding',employee);
    assert.deepEqual(quest.steps.map(row => row.status),['available','locked','locked']);
    assert.equal((await send('/tasks/'+quest.steps[1].id+'/submit',employee,'POST',{note})).data.error.code,'STEP_LOCKED');
    for (const step of quest.steps) {
      const report = await get('/onboarding/'+step.id+'/submit',employee,'POST',{note},201);
      assert.equal((await get('/onboarding',employee)).steps.find(row => row.id === step.id).status,'pending');
      await get('/admin/submissions/'+report.id,admin,'PATCH',{status:'approved'});
    }
    quest = await get('/onboarding',employee);
    assert.equal(quest.current,null);
    assert.equal(quest.earned,260);
    assert.equal((await get('/challenges/'+first.id,employee)).progress,1);
    await get('/challenges/'+first.id+'/claim',employee,'POST',undefined,201);
    assert.equal((await send('/challenges/'+first.id+'/claim',employee,'POST')).status,409);
    for (const [index, cookie] of [employee, colleague].entries()) {
      const report = await get('/tasks/'+team.tasks[index].id+'/submit',cookie,'POST',{note},201);
      await get('/admin/submissions/'+report.id,admin,'PATCH',{status:'approved'});
    }
    assert.equal((await get('/challenges/'+team.id,employee)).progress,2);
    assert.equal((await get('/challenges/'+team.id,colleague)).progress,2);
    await get('/challenges/'+team.id+'/claim',employee,'POST',undefined,201);
    const directory = await get('/employees?q='+encodeURIComponent('РАЗРАБОТКА'),employee);
    assert.deepEqual(directory.items.map(row=>row.name),['Алекс Морозов','Ирина Волкова']);
    const profile = await get('/employees/'+directory.items[0].id,colleague);
    assert.equal(profile.email,undefined);
    assert.equal(profile.achievements.length,4);
    assert.equal(profile.badges.length,2);
  });

  it('validates cart quantity, checks out atomically and preserves the cashback offer after archiving', async () => {
    const [offer] = (await get('/cashback',employee)).campaigns;
    const rewards = (await get('/rewards')).items;
    const coffee = rewards.find(row => row.image === 'coffee');
    assert.equal((await send('/cart/'+coffee.id,employee,'PUT',{quantity:21})).status,422);
    await get('/cart/'+coffee.id,employee,'PUT',{quantity:2});
    const before = await balance(employee);
    const replies = await Promise.all(Array.from({length:2},() => send('/cart/checkout',employee,'POST',{comment:'Заберу в офисе'})));
    assert.deepEqual(replies.map(row => row.status).sort(),[201,409]);
    orderId = replies.find(row => row.status === 201).data.id;
    assert.equal(await balance(employee),before-160);
    assert.deepEqual((await get('/cart',employee)).items,[]);
    assert.deepEqual((await get('/orders',colleague)).items,[]);
    assert.equal((await get('/orders',employee)).items[0].items[0].quantity,2);
    await get('/admin/orders/'+orderId,admin,'PATCH');
    assert.equal((await get('/orders',employee)).items[0].status,'fulfilled');
    await get('/admin/cashback/'+offer.id,admin,'PATCH',{active:false});
    assert.equal((await get('/cashback',employee)).items[0].points,40);
    assert.equal((await send('/cashback/'+offer.id+'/claim',employee,'POST',{order_id:orderId})).data.error.code,'TASK_REQUIRED');
    assert.equal((await send('/cashback/'+offer.id+'/submit',colleague,'POST',{order_id:orderId,note})).status,404);
    await get('/cashback/'+offer.id+'/submit',employee,'POST',{order_id:orderId,note},201);
    await get('/admin/cashback/reports/'+orderId,admin,'PATCH',{campaign_id:offer.id,status:'rejected',feedback:'Добавьте результат.'});
    await get('/cashback/'+offer.id+'/submit',employee,'POST',{order_id:orderId,note},201);
    await get('/admin/cashback/reports/'+orderId,admin,'PATCH',{campaign_id:offer.id,status:'approved'});
    const result = await get('/cashback/'+offer.id+'/claim',employee,'POST',{order_id:orderId},201);
    assert.equal(result.points,40);
    assert.equal(await balance(employee),before-120);
    assert.equal((await send('/cashback/'+offer.id+'/claim',employee,'POST',{order_id:orderId})).status,409);
  });

  it('enforces the weekly spin, hides quiz answers before voting and returns a displaced auction bid', async () => {
    const old = await balance(employee);
    const spins = await Promise.all(Array.from({length:2},() => send('/wheel/spin',employee,'POST',{stake:5})));
    assert.deepEqual(spins.map(row => row.status).sort(),[201,409]);
    const result = spins.find(row => row.status === 201).data;
    assert.equal(await balance(employee),old+5*(result.multiplier-1));
    assert.equal(result.next_at-result.spun_at,7*86400000);
    const { items } = await get('/polls',employee);
    const survey = items.find(row => row.mode === 'survey');
    const quiz = items.find(row => row.mode === 'quiz');
    assert.equal(quiz.options[0].correct,undefined);
    assert.equal((await send('/polls/'+quiz.id+'/vote',employee,'POST',{option_id:survey.options[0].id})).status,422);
    const votes = await Promise.all(Array.from({length:2},() => send('/polls/'+quiz.id+'/vote',employee,'POST',{option_id:quiz.options[0].id})));
    assert.deepEqual(votes.map(row=>row.status).sort(),[201,409]);
    assert.equal(votes.find(row => row.status === 201).data.points,25);
    assert.equal((await get('/polls',employee)).items.find(row=>row.id===quiz.id).options[0].correct,1);
    const lot = (await get('/auctions',employee)).items.find(row=>row.open);
    const employeeBefore = await balance(employee);
    const colleagueBefore = await balance(colleague);
    await get('/auctions/'+lot.id+'/bid',employee,'POST',{amount:50},201);
    assert.equal(await balance(employee),employeeBefore-50);
    assert.equal((await send('/auctions/'+lot.id+'/bid',colleague,'POST',{amount:50})).status,409);
    await get('/auctions/'+lot.id+'/bid',colleague,'POST',{amount:55},201);
    assert.equal(await balance(employee),employeeBefore);
    assert.equal(await balance(colleague),colleagueBefore-55);
    await get('/auctions/'+lot.id+'/bid',colleague,'POST',{amount:57},201);
    assert.equal(await balance(colleague),colleagueBefore-57);
  });

  it('records one Pomodoro interval per run and publishes admin-defined activities', async () => {
    const data = {run_id:randomUUID(),kind:'focus',minutes:25,day:'2026-11-21'};
    await get('/pomodoro',employee,'POST',data);
    await get('/pomodoro',employee,'POST',data);
    assert.deepEqual((await get('/pomodoro?day='+data.day,employee)).items,[{kind:'focus',runs:1,minutes:25}]);
    assert.equal((await send('/pomodoro?day=2026-02-30',employee)).status,422);
    const poll = await get('/admin/polls',admin,'POST',{ title:'Демо опрос',question:'Как вы сегодня?',mode:'survey',
      options:['Хорошо','Отлично'],points:10 },201);
    assert.ok((await get('/polls',employee)).items.some(row => row.id === poll.id));
    await get('/admin/polls/'+poll.id,admin,'PATCH',{active:false});
    assert.ok(!(await get('/polls',employee)).items.some(row => row.id === poll.id));
    const now = Date.now();
    const challenge = await get('/admin/challenges',admin,'POST',{title:'Тест команды',description:'Задание для проверки сценария.',
      mode:'individual',task_ids:[1],target:1,points:25,badge:'Тест',starts_at:now-1000,ends_at:now+60000},201);
    assert.ok((await get('/challenges',employee)).items.some(row => row.id === challenge.id));
    const lot = await get('/admin/auctions',admin,'POST',{title:'Проверка торгов',minimum:80,reward_id:3,ends_at:now+60000},201);
    assert.equal((await send('/admin/auctions/'+lot.id,admin,'PATCH')).data.error.code,'AUCTION_OPEN');
  });

  it('validates Telegram webhook ownership and dispatches queued cashback through the test transport', async () => {
    const { url } = await get('/telegram/link',employee,'POST',undefined,201);
    const code = new URL(url).searchParams.get('start');
    const body = { message:{chat:{id:123456,type:'private'},text:'/start '+code} };
    assert.equal((await send('/telegram/webhook',null,'POST',body)).status,403);
    assert.equal((await send('/telegram/webhook',null,'POST',body,{'X-Telegram-Bot-Api-Secret-Token':secret})).status,200);
    assert.equal((await get('/telegram',employee)).linked,true);
    for (let attempt = 0; !deliveries.length && attempt < 120; attempt++) await delay(50);
    assert.deepEqual(deliveries.map(row => row.text),[
      'Кэшбек за заказ №'+orderId+': +40 б.',
      'Уведомления «Командного хода» подключены.',
    ]);
    assert.ok(deliveries.every(row => row.chat_id === '123456'));
  });

  it('manages categories, employee profiles and branding without exposing admin writes', async () => {
    assert.equal((await send('/admin/reward-categories',employee)).status,403);
    const code = 'events';
    const label = 'Впечатления';
    const saved = await get('/admin/reward-categories',admin,'POST',{code,label},201);
    assert.equal(saved.code,code);
    const offer = await get('/admin/rewards',admin,'POST',{
      title:'Билет на выставку',description:'Приглашение на выставку для сотрудника.',category:code,points:50,
    },201);
    assert.equal((await get('/rewards?category='+code)).items[0].category,code);
    assert.equal((await send('/admin/reward-categories/'+code,admin,'PATCH',{label,active:false})).data.error.code,'CATEGORY_IN_USE');
    await get('/admin/rewards/'+offer.id,admin,'DELETE',undefined,204);
    await get('/admin/reward-categories/'+code,admin,'PATCH',{label:'События',active:false});
    assert.ok(!(await get('/reward-categories')).items.some(row=>row.code===code));
    const profiles = await get('/admin/employees',admin);
    const id = profiles.items.find(row=>row.name==='Ирина Волкова').id;
    await get('/admin/employees/'+id,admin,'PATCH',{department:'Разработка',name:'Ирина Орлова',bio:'Показываю работу интерфейса.'});
    assert.equal((await get('/employees/'+id,employee)).name,'Ирина Орлова');
    const settings = {name:'Команда <тест>',description:'Текст с символами "SEO" для проверки.',contact:'team@example.test',social_url:'https://example.test/team',admin_theme:'slate'};
    assert.equal((await send('/admin/settings',employee,'PUT',settings)).status,403);
    assert.equal((await send('/admin/settings',admin,'PUT',{...settings,social_url:'javascript:void(0)'})).status,422);
    await get('/admin/settings',admin,'PUT',settings);
    assert.equal((await get('/settings')).name,settings.name);
    const html = await (await fetch(origin+'/')).text();
    assert.ok(html.includes('<title>Команда &lt;тест&gt;</title>'));
    assert.ok(html.includes('content="Текст с символами &quot;SEO&quot; для проверки."'));
    const png = await readFile(new URL('../public/team-brand.png',import.meta.url));
    const upload = body => fetch(origin+'/api/admin/settings/logo',{method:'PUT',headers:{Cookie:admin,'Content-Type':'image/png'},body});
    assert.equal((await upload(Buffer.from('wrong image'))).status,422);
    assert.equal((await (await upload(png)).json()).custom_logo,true);
    const logo = await fetch(origin+'/site-logo');
    assert.equal(logo.headers.get('Content-Type'),'image/png');
    assert.deepEqual(Buffer.from(await logo.arrayBuffer()),png);
    assert.equal((await get('/admin/settings/logo',admin,'DELETE')).custom_logo,false);
  });
});
