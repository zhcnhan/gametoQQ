/** 一次性：列出**真源**里活着的点位 id 与专长，供新事件写 `onlyShops` 时引用。 */
import { SHOP_DEFS } from '../src/data/shops';

console.log(`SHOP_DEFS 共 ${SHOP_DEFS.length} 个：`);
for (const s of SHOP_DEFS) {
  console.log(
    `  ${s.id.padEnd(16)} ${s.name.padEnd(8)} tier${s.tier}  专长 [${(s.specialty ?? []).join('/')}]  上架 ${s.offers.length} 种`
  );
}
