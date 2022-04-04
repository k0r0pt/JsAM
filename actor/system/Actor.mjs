import { Queue } from '../../ds/Queue.mjs';
import { ActorRef } from './ActorRef.mjs';
import log4js from 'log4js';

const logger = log4js.getLogger('Actor');

export class Actor extends ActorRef {

  /**
   * The {@link ActorBehavior} for this actor.
   */
  #behavior;
  #queue;
  status = 'IDLE';
  #errorHandler;
  #loggingPrefix;

  /**
   * Constructor. This will init the Actor. The children will be an array of {@link ActorRef} because they can be on different nodes.
   *
   * @param {ActorSystem} actorSystem The actor system
   * @param {string} name The actor name
   * @param {Actor} locator The actor locator
   * @param {string} actorUrl The complete Actor Url
   * @param {string} behaviorDefinition The actor Behavior Definition file
   * @param {Function} errorHandler The (optional) error handler function
   */
  constructor(actorSystem, name, locator, actorUrl, behaviorDefinition, errorHandler) {
    super(actorSystem, name, locator, actorUrl);
    if (name.includes('/')) {
      throw new Error('Actor name cannot have / in it.');
    }
    this.#queue = new Queue(this);
    this.#errorHandler = errorHandler;
    this.#loggingPrefix = '[' + name + '@' + actorSystem.getClusterManager().getMe().getIdentifier() + ']';
    return this.#resolveBehavior(behaviorDefinition);
  }

  async #resolveBehavior(behaviorDefinition) {
    if (behaviorDefinition) {
      var behaviorDefFunction = await import(process.cwd() + '/' + behaviorDefinition);
      this.#behavior = behaviorDefFunction.default();
    }
    return this;
  }

  getQueue() {
    return this.#queue;
  }

  async process() {
    if (this.status === 'IDLE') {
      if (this.#queue.getLength() > 0) {
        this.status = 'PROCESSING';
        try {
          var msg = this.#queue.dequeue();
          logger.debug(this.#loggingPrefix, ' Processing message: ', msg.getMessage());
          await this.#behavior.process(msg, this);
        } catch (err) {
          logger.error(this.#loggingPrefix, 'Processing failed with error! Continuing to the next message...', err);
          this.#errorHandler && this.#errorHandler();
        }
        this.status = 'IDLE';
        this.process();
      } else {
        this.status = 'IDLE';
      }
    }
  }

  async shutdown() {
    this.actorSystem.getClusterManager().removeActor()
  }
}
