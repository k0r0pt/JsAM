import { Actor } from './Actor.mjs';
import { ActorBehavior } from './ActorBehavior.mjs';

export class RootActor extends Actor {

  /**
   * Constructor. This will init the actorSystem and children. The children will be an array of {@link ActorRef} because they can be on different nodes.
   *
   * @param {ActorSystem} actorSystem The Actor System.
   */
  constructor(actorSystem) {
    super(actorSystem, 'ROOT', '-/');
    // Add default behaviors.
    this._behavior = new ActorBehavior();
  }

  removeChild(locator) {
    super.removeChild(locator);
  }
}
