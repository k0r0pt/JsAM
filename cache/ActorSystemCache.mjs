import nodeUtil from 'util';

export class ActorSystemCache {

  #actorSystem;
  #cache;

  constructor(actorSystem) {
    this.#actorSystem = actorSystem;
    this.#cache = {};
  }

  get(key) {
    return this.#cache[key];
  }

  set(key, value) {
    this.#cache[key] = value;
  }

  /**
   * Sets the value against the key in the local cache, and synchronizes that with all the nodes.
   *
   * @param {string} key The cache key
   * @param {object} value The cache value
   */
  async setAndSync(key, value) {
    this.set(key, value);
    await this.#sync(key, value);
  }

  clear(key) {
    delete this.#cache[key];
  }

  async clearAndSync(key) {
    this.clear(key)
    await this.#sync(key, undefined);
  }

  async #sync(key, value) {
    await nodeUtil.promisify(this.#actorSystem.getClusterManager().syncCache).bind(this.#actorSystem.getClusterManager())(key, value);
  }
}