import { GameStore } from '../src/state/store';
import { createSaveGame, serialize, deserialize } from '../src/state/save';
import { createStartingRun } from '../src/systems/setup';
import { chooseIdentity, ensureDayStocks } from '../src/systems/phases';
import { canTrade, tradeForBox } from '../src/systems/trade';
import { enterShop, buyCart, resolveDayEvent } from '../src/systems/shop';
import { setSlotStack, getStack, makeStack, stackCount } from '../src/model/shelf';
import { countByItem } from '../src/model/consume';

const noop = { schedule() {}, flush() {}, dispose() {}, pending: false };

// —— T13 交易小器件数 ——
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
  console.log('[T13] trade ok:', r.ok, JSON.stringify(r.events));
  const shelf = getStack(run.shelves[0], { row: 0, col: 0 });
  console.log('[T13] shelf count after:', shelf ? stackCount(shelf) : null);
  const all = countByItem(run.shelves, run.boxesToUnpack).find(s => s.itemId === 'canned_beans');
  console.log('[T13] house canned_beans total:', all && all.count, 'integer?', Number.isInteger(all && all.count));
}

// —— T15 手改档价格 null ——
{
  const store = new GameStore(createSaveGame(null), noop);
  store.replaceRun(createStartingRun(1014));
  chooseIdentity(store, 'porter');
  ensureDayStocks(store);
  const raw = JSON.parse(serialize(store.save));
  console.log('[T15] shopStocks len:', raw.run.shopStocks.length, 'lines0:', raw.run.shopStocks[0]?.lines?.length);
  raw.run.shopStocks[0].lines[0].price = NaN; // -> null in JSON
  const loaded = deserialize(JSON.stringify(raw));
  const st = new GameStore(loaded, noop);
  enterShop(st, raw.run.shopStocks[0].shopId);
  if (st.run.dayEvent) resolveDayEvent(st, 0);
  const line = loaded.run.shopStocks[0].lines[0];
  console.log('[T15] price after normalize:', line.price, 'stock:', line.stock);
  const cash0 = st.run.cash;
  const r = buyCart(st, raw.run.shopStocks[0].shopId, [ { itemId: line.itemId, count: 2 } ]);
  console.log('[T15] buy ok:', r.ok, 'cash', cash0, '->', st.run.cash);
}
