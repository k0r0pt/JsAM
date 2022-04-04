import { Actor } from '../actor/system/Actor.mjs';

export class LocalReceptionist {
  constructor() {
    this.localActors = {};
  }

  /**
   * Adds a local actor to the lookup table.
   *
   * @param {string} locator The actor locator
   * @param {Actor} actor The Actor
   */
  addActor(locator, actor) {
    this.localActors[locator] = actor;
  }

  lookup(locator) {
    return this.localActors[locator];
  }
}