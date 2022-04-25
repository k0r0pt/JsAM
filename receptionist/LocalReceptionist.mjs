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

  removeActor(locator) {
    delete this.localActors[locator];
  }

  lookup(locator) {
    return this.localActors[locator];
  }

  getLocalActorRefs() {
    var actorRefs = [];
    Object.keys(this.localActors).forEach(locator => {
      var actor = this.localActors[locator];
      actorRefs.push({ name: actor.getName(), locator: actor.getLocator(), actorUrl: actor.getActorUrl(), behaviorDefinition: actor.getBehaviorDefinition() });
    });
    return actorRefs;
  }
}