import * as activity from './activity.js';
import * as shop from './shop.js';
import * as management from './game-admin.js';
import { rewardCategories, saveCategory, saveSiteSettings, siteSettings } from './settings.js';
import { json, readJson } from './http.js';

export function createGameApi(db, telegram, submitTask) {
  const routes = [
    ['GET', '/reward-categories', null, 200, () => rewardCategories(db)],
    ['GET', '/settings', null, 200, () => siteSettings(db)],
    ['GET', '/wheel', 'employee', 200, ({ user }) => activity.wheel(db, user.id)],
    ['POST', '/wheel/spin', 'employee', 201, ({ user, body }) => activity.spin(db, user.id, body.stake), true],
    ['GET', '/cart', 'employee', 200, ({ user }) => shop.cart(db, user.id)],
    ['PUT', '/cart/:id', 'employee', 200, ({ user, id, body }) => shop.updateCart(db, user.id, id, body), true],
    ['POST', '/cart/checkout', 'employee', 201, ({ user, body }) => shop.checkout(db, user.id, body), true],
    ['GET', '/orders', 'employee', 200, ({ user }) => shop.orders(db, user.id)],
    ['GET', '/onboarding', 'employee', 200, ({ user }) => activity.onboarding(db, user.id)],
    ['POST', '/onboarding/:id/submit', 'employee', 201, ({ user, id, body }) => submitTask(db, user, id, body, true), true],
    ['GET', '/employees', 'authenticated', 200, ({ user, url }) => activity.employees(db, user.id, url)],
    ['GET', '/employees/:id', 'authenticated', 200, ({ user, id, url }) => activity.employees(db, user.id, url, id)],
    ['PATCH', '/me/employee', 'employee', 200, ({ user, body }) => activity.updateEmployee(db, user.id, body), true],
    ['GET', '/challenges', 'employee', 200, ({ user }) => activity.challenges(db, user.id)],
    ['GET', '/challenges/:id', 'employee', 200, ({ user, id }) => activity.challenge(db, user.id, id)],
    ['POST', '/challenges/:id/join', 'employee', 200, ({ user, id }) => activity.joinChallenge(db, user.id, id)],
    ['POST', '/challenges/:id/claim', 'employee', 201, ({ user, id }) => activity.claimChallenge(db, user.id, id)],
    ['GET', '/polls', 'employee', 200, ({ user }) => activity.polls(db, user.id)],
    ['POST', '/polls/:id/vote', 'employee', 201, ({ user, id, body }) => activity.vote(db, user.id, id, body.option_id), true],
    ['GET', '/auctions', 'employee', 200, ({ user }) => activity.auctions(db, user.id)],
    ['GET', '/auctions/:id', 'employee', 200, ({ user, id }) => activity.auction(db, user.id, id)],
    ['POST', '/auctions/:id/bid', 'employee', 201, ({ user, id, body }) => activity.bid(db, user.id, id, body.amount), true],
    ['GET', '/cashback', 'employee', 200, ({ user }) => shop.cashback(db, user.id)],
    ['POST', '/cashback/:id/submit', 'employee', 201, ({ user, id, body }) => shop.submitCashback(db, user.id, id, body), true],
    ['POST', '/cashback/:id/claim', 'employee', 201, ({ user, id, body }) => shop.claimCashback(db, user.id, id, body), true],
    ['GET', '/pomodoro', 'employee', 200, ({ user, url }) => activity.pomodoro(db, user.id, url.searchParams.get('day'))],
    ['POST', '/pomodoro', 'employee', 200, ({ user, body }) => activity.recordSession(db, user.id, body), true],
    ['GET', '/telegram', 'employee', 200, ({ user }) => telegram.status(user.id)],
    ['POST', '/telegram/link', 'employee', 201, ({ user }) => telegram.link(user.id)],
    ['POST', '/telegram/webhook', null, 200, ({ request, body }) => telegram.webhook(request.headers['x-telegram-bot-api-secret-token'], body), true],
    ['GET', '/admin/orders', 'admin', 200, () => shop.orders(db)],
    ['PATCH', '/admin/orders/:id', 'admin', 200, ({ id }) => shop.fulfill(db, id)],
    ['GET', '/admin/employees', 'admin', 200, ({ user, url }) => activity.employees(db, user.id, url, null, true)],
    ['PATCH', '/admin/employees/:id', 'admin', 200, ({ id, body }) => activity.updateEmployee(db, id, body, true), true],
    ['GET', '/admin/challenges', 'admin', 200, ({ user }) => activity.challenges(db, user.id)],
    ['POST', '/admin/challenges', 'admin', 201, ({ body }) => management.saveChallenge(db, body), true],
    ['PATCH', '/admin/challenges/:id', 'admin', 200, ({ id, body }) => management.setChallengeActive(db, id, body.active), true],
    ['GET', '/admin/polls', 'admin', 200, ({ user }) => activity.polls(db, user.id, true)],
    ['POST', '/admin/polls', 'admin', 201, ({ body }) => management.savePoll(db, body), true],
    ['PATCH', '/admin/polls/:id', 'admin', 200, ({ id, body }) => management.setPollActive(db, id, body.active), true],
    ['GET', '/admin/auctions', 'admin', 200, ({ user }) => activity.auctions(db, user.id)],
    ['POST', '/admin/auctions', 'admin', 201, ({ body }) => management.saveAuction(db, body), true],
    ['PATCH', '/admin/auctions/:id', 'admin', 200, ({ id }) => management.closeAuction(db, id)],
    ['GET', '/admin/cashback', 'admin', 200, () => management.campaigns(db)],
    ['POST', '/admin/cashback', 'admin', 201, ({ body }) => management.saveCampaign(db, body), true],
    ['PATCH', '/admin/cashback/:id', 'admin', 200, ({ id, body }) => management.setCampaignActive(db, id, body.active), true],
    ['GET', '/admin/cashback/reports', 'admin', 200, () => shop.cashbackReports(db)],
    ['PATCH', '/admin/cashback/reports/:id', 'admin', 200, ({ id, body }) => shop.reviewCashback(db, id, body), true],
    ['GET', '/admin/reward-categories', 'admin', 200, () => rewardCategories(db, true)],
    ['POST', '/admin/reward-categories', 'admin', 201, ({ body }) => saveCategory(db, null, body), true],
    ['PATCH', '/admin/reward-categories/:code', 'admin', 200, ({ key, body }) => saveCategory(db, key, body), true],
    ['PUT', '/admin/settings', 'admin', 200, ({ body }) => saveSiteSettings(db, body), true],
  ].map(([method, path, access, status, handler, hasBody]) => ({
    method, pattern: new RegExp('^/api' + path.replace(':id', '([1-9][0-9]{0,14})').replace(':code', '([a-z][a-z0-9-]{1,39})') + '$'),
    access, status, handler, hasBody,
  }));

  return async (request, response, url, access) => {
    for (const entry of routes) {
      if (request.method !== entry.method) continue;
      const match = entry.pattern.exec(url.pathname);
      if (!match) continue;
      const user = entry.access ? access[entry.access]() : null;
      const body = entry.hasBody ? await readJson(request) : undefined;
      json(response, entry.status, entry.handler({ user, id: Number(match[1]), key: match[1], body, request, url }));
      return true;
    }
    return false;
  };
}
