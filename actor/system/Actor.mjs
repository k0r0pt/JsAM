import { Queue } from '../../ds/Queue.mjs';
import { ActorRef } from './ActorRef.mjs';
import log4js from 'log4js';
import nodeUtil from 'util';

const logger = log4js.getLogger('Actor');

export class Actor extends ActorRef {

  /**
   * The {@link ActorBehavior} for this actor.
   */
  _behavior;
  #queue;
  status = 'IDLE';
  #loggingPrefix;
  #state;
  #amTransferred = false;

  /**
   * Constructor. This will init the Actor. The children will be an array of {@link ActorRef} because they can be on different nodes.
   *
   * @param {ActorSystem} actorSystem The actor system
   * @param {string} name The actor name
   * @param {string} locator The actor locator
   * @param {string} actorUrl The complete Actor Url
   * @param {string} behaviorDefinition The Behavior Definition File location
   * @param {object} state The Actor State
   */
  constructor(actorSystem, name, locator, actorUrl, behaviorDefinition, state) {
    super(actorSystem, name, locator, actorUrl, behaviorDefinition);
    if (name.includes('/')) {
      throw new Error('Actor name cannot have / in it.');
    }
    this.#queue = new Queue(this);
    this.#state = !state || !JSON.parse(state) ? {} : JSON.parse(state);
    this.#loggingPrefix = '[' + name + '@' + actorSystem.getClusterManager().getMe().getIdentifier() + ']';
    return this.#resolveBehavior(behaviorDefinition);
  }

  async #resolveBehavior(behaviorDefinition) {
    if (behaviorDefinition) {
      var behaviorDefFunction = await import(process.cwd() + '/' + behaviorDefinition);
      this._behavior = behaviorDefFunction.default();
      await nodeUtil.promisify(this._behavior.start).bind(this._behavior)(this);
    }
    return this;
  }

  getState() {
    return this.#state;
  }

  getQueue() {
    return this.#queue;
  }

  setTransferStatus() {
    this.#amTransferred = true;
  }

  async process() {
    if (this.status === 'IDLE') {
      if (this.#queue.getLength() > 0) {
        this.status = 'PROCESSING';
        try {
          var msg = this.#queue.dequeue();
          logger.isTraceEnabled() && logger.trace(this.#loggingPrefix, ' Processing message: ', msg.getMessage());
          await this._behavior.process(msg, this);
        } catch (err) {
          logger.error(this.#loggingPrefix, 'Processing failed with error! Continuing to the next message...', err);
        }
        this.status = 'IDLE';
        this.process();
      } else if (this.#amTransferred) {
        // I've been transferred, and I'm done processing everything in my queue. Let's clean up.
        this.shutdown();
      }
    }
  }

  async shutdown() {
    // Let's remove the no longer needed references as I'm only a reference to the actual (remote) actor now.
    this.#queue = undefined;
    this._behavior = undefined;
    this.#state = undefined;
  }
}
