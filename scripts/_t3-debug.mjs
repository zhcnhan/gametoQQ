import { GameStore } from '../src/state/store';
import { createSaveGame, serialize, deserialize } from '../src/state/save';
import { createStartingRun } from '../src/systems/setup';
import { chooseIdentity, goOut, ensureDayStocks } from '../src/systems/phases';
import { canTrade, tradeForBox } from '../src/systems/trade';
import { enterShop, buyCart, resolveDayEvent } from '../src/systems/shop';
import { setSlotStack, getStack, makeStack, stackCount } from '../src/model/shelf';
import { countByItem } from '../src/model/consume';

const noop = { schedule() {}, flush() {}, dispose() {}, pending: false };

// —— T13 ——
{
  const store = new GameStore(createSaveGame(null), noop);
  store.replaceRun(createStartingRun(1013));
  chooseIdentity(store, 'porter');
  const run = store.run;
  run.phase = 'survival_day';
  run.day = 3;
  run.survival.last.hardPress = true;
  run.shelves[0] = setSlotStack(run.shelves[0], { row: 0, col: 0 }, makeStack('canned_beans', 6, null));
  console.log('[T13] canTrade:', canTrade(run));
  const r = tradeForBox(store, [ { itemId: 'canned_beans', count: 1.5 }, { itemId: 'canned_beans', count: 1.5 } ]);
  console.log('[T13] ok:', r.ok, JSON.stringify(r.events));
  const shelf = getStack(store.run.shelves[0], { row: 0, col: 0 });
  const all = countByItem(store.run.shelves, store.run.boxesToUnpack).find(s => s.itemId === 'canned_beans');
  console.log('[T13] shelf count:', shelf ? stackCount(shelf) : null, '| house total:', all && all.count, '| integer?', Number.isInteger(all && all.count));
}

// —— T15：看看 shopStocks 什么时候有货 ——
{
  const store = new GameStore(createSaveGame(null), noop);
  store.replaceRun(createStartingRun(1014));
  chooseIdentity(store, 'porter');
  console.log('[T15] after chooseIdentity: phase=', store.run.phase, 'shopStocks=', store.run.shopStocks.length);
  goOut(store);
  console.log('[T15] after goOut: phase=', store.run.phase, 'shopStocks=', store.run.shopStocks.length, 'lines0=', store.run.shopStocks[0]?.lines?.length);
  const raw = JSON.parse(serialize(store.save));
  raw.run.shopStocks[0].lines[0].price = NaN;
  const loaded = deserialize(JSON.stringify(raw));
  const st = new GameStore(loaded, noop);
  const line = loaded.run.shopStocks[0].lines[0];
  console.log('[T15] price after normalize:', line.price, 'stock:', line.stock, 'item:', line.itemId);
  enterShop(st, raw.run.shopStocks[0].shopId);
  if (st.run.dayEvent) resolveDayEvent(st, 0);
  const cash0 = st.run.cash;
  const r = buyCart(st, raw.run.shopStocks[0].shopId, [ { itemId: line.itemId, count: 2 } ]);
  console.log('[T15] buy ok:', r.ok, '| cash', cash0, '->', st.run.cash, '| problems:', JSON.stringify(r.events?.filter(e=>e.type==='rejected')));
}
