/**
 * 存档介质抽象（§4A 原子存档 / 云备份预留接入点）。
 *
 * 这是整个项目里**唯一**允许直接摸 window.localStorage 的文件：
 * 其余层通过注入的 StorageLike 工作，这样单测可以在 node 里跑假存储，
 * 将来接云备份时也只是换一个实现（CloudStore interface 在 M2 落地）。
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createMemoryStorage(seed?: Record<string, string>): StorageLike {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    }
  };
}

let cached: StorageLike | null = null;

/** 浏览器里给 localStorage；隐私模式/无 window（单测）时退化为内存存储，绝不抛异常 */
export function resolveStorage(): StorageLike {
  if (cached) return cached;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const probe = '__tunhuo_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      cached = window.localStorage;
      return cached;
    }
  } catch {
    // 隐私模式下 localStorage 可用但写入抛异常 —— 静默退化，保证"杀进程损失=0"以外不新增崩溃点
  }
  cached = createMemoryStorage();
  return cached;
}

/** 仅供测试注入 */
export function __setStorageForTest(storage: StorageLike | null): void {
  cached = storage;
}
