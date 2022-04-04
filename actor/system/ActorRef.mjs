import axios from 'axios';
import log4js from 'log4js';
import { Constants } from '../../constants/Constants.mjs';
import { Message } from '../../dto/Message.mjs';
import { QueueingException } from '../../exception/QueueingException.mjs';
import nodeUtil from 'util';

const logger = log4js.getLogger('ActorRef');

export class ActorRef {

  /**
   * The {@link ActorRef} Map of this actor's children.
   */
  #children = {};

  /**
   * The Constructor.
   *
   * @param {ActorSystem} actorSystem The Actor System
   * @param {string} name The actor name
   * @param {string} locator The actor locator in the Actor System
   * @param {string} actorUrl The Url for the actor
   */
  constructor(actorSystem, name, locator, actorUrl) {
    this.name = name;
    this.actorSystem = actorSystem;
    this.locator = locator;
    this.actorUrl = actorUrl;
  }

  /**
   * Gets the Actor Locator.
   *
   * @returns the locator for this actor
   */
  getLocator() {
    return this.locator;
  }

  getActorUrl() {
    return this.actorUrl;
  }

  getQueue() {
    throw new Error('Queueing not supported directly in remote ActorRef.');
  }

  getActorSystem() {
    return this.actorSystem;
  }

  getName() {
    return this.name;
  }

  /**
   * Spawns a child actor with the given name and having the given behavior.
   *
   * @param {string} childActorName The Child Actor name
   * @param {ActorBehavior} behaviorDefinition The file containing {@link ActorBehavior} definition for the child actor
   * @param {Function} errorHandler The Error Handler function
   * @returns An instance of {@link ActorRef}
   */
  async spawnChild(childActorName, behaviorDefinition, errorHandler) {
    if (this.#children[childActorName]) {
      if (this.#children[childActorName] instanceof Actor) {
        throw new ActorCreationException('A child actor with the name ' + childActorName + ' already exists.');
      }
      // We already have the remote actor reference.
      return this;
    }
    // TODO Initiate state replay. Once done, emit event saying that the child actor was spawned.
    var lastLocator = (this.locator !== Constants.ROOT_LOC ? '/' : '') + childActorName;
    var locator = this.locator + lastLocator;
    var clusterManager = this.actorSystem.getClusterManager();
    this.#children[childActorName] = await nodeUtil.promisify(clusterManager.createActor).bind(clusterManager)(childActorName, locator, behaviorDefinition, errorHandler);
    logger.debug('Child Actor Created', this.#children[childActorName].getName());
    return this;
  }

  /**
   * Gets the child actor specified by the name.
   *
   * @param {string} childActorName 
   * @returns The Child {@link ActorRef}
   */
  getChild(childActorName) {
    return this.#children[childActorName];
  }

  async tell(messageType, message) {
    messageType = messageType ?? 'default';
    if (!(this instanceof ActorRef)) {
      // Local actor. Let's do this!
      var queueMsg = new Message(messageType, message);
      this.getQueue().enqueue(queueMsg);
      return;
    }
    try {
      await axios.put(this.actorUrl, { messageType: messageType, message: message });
    } catch (reason) {
      var msg = 'Queueing to' + this.locator + 'failed because of this reason:' + reason;
      logger.error(msg);
      throw new QueueingException(msg);
    }
  }

  ask(messageType, message, callback) {
    if (this instanceof Actor) {
      // Local actor. Let's do this!
      return;
    }
  }

  getParent() {
    if (this.locator === Constants.ROOT_LOC) {
      return null;
    }
    return this.actorSystem.getReceptionist().lookup(this.#getParentLocator(this.locator));
  }

  #getParentLocator() {
    var locatorParts = this.locator.split('/');
    var parentLocator = '';
    for (var i = 0; i < locatorParts.length - 1; i++) {
      parentLocator = parentLocator.concat(locatorParts[i]);
    }
    return parentLocator;
  }

  serialize() {
    return this.#getSerializable(this);
  }

  #getSerializable(actor) {
    var obj = {};
    obj.name = actor.name;
    obj.locator = actor.locator;
    obj.actorUrl = actor.actorUrl;
    obj.children = {};
    if (actor.#children) {
      for (var child of Object.keys(actor.#children)) {
        obj.children[child] = this.#getSerializable(actor.#children[child]);
      }
    }
    return obj;
  }
}