import log4js from 'log4js';
import { Constants } from '../../constants/Constants.mjs';
import { Message } from '../../dto/Message.mjs';
import { QueueingException } from '../../exception/QueueingException.mjs';
import nodeUtil from 'util';
import getUtilInstance from '../../util/Util.mjs';
import { ActorCreationException } from '../../exception/ActorCreationException.mjs';

const logger = log4js.getLogger('ActorRef');
const util = getUtilInstance();

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
    this.host = actorSystem.getClusterManager().resolveToHost(this.actorUrl);
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

  getActorSystem() {
    return this.actorSystem;
  }

  getName() {
    return this.name;
  }

  getHost() {
    return this.host;
  }

  /**
   * Spawns a child actor with the given name and having the given behavior.
   *
   * @param {string} childActorName The Child Actor name
   * @param {ActorBehavior} behaviorDefinition The file containing {@link ActorBehavior} definition for the child actor
   * @returns An instance of {@link ActorRef}
   */
  async spawnChild(childActorName, behaviorDefinition) {
    if (childActorName.includes('/')) {
      throw new ActorCreationException('Actor cannot have the character / in its name.');
    }
    if (this.#children[childActorName]) {
      // We already have the child actor reference.
      return this;
    }
    // TODO Initiate state replay. Once done, emit event saying that the child actor was spawned.
    var lastLocator = (this.locator !== Constants.ROOT_LOC ? '/' : '') + childActorName;
    var locator = this.locator + lastLocator;
    var clusterManager = this.actorSystem.getClusterManager();
    this.#children[childActorName] = await nodeUtil.promisify(clusterManager.createActor).bind(clusterManager)(childActorName, locator, behaviorDefinition);
    logger.isTraceEnabled() && logger.trace('Child Actor Created', this.#children[childActorName].getName());
    return this;
  }

  /**
   * Gets the child actor specified by the name.
   *
   * @param {string} childActorName 
   * @returns The Child {@link ActorRef}
   */
  getChild(childActorName) {
    // If I am in this node, I already have my children. If I'm not here, I need to sync my children from the receptionist.
    if (!this.#children[childActorName]) {
      // My Child is not here. Let's get my child from the Receptionists.
      // Let's ask the LocalReceptionist if my child is here.
      // If the LocalReceptionist doesn't have my child, let's ask the Receptionist.
      // If neither have my child, my child doesn't exist.
      var childLocator = this.locator + '/' + childActorName;
      this.#children[childActorName] = this.actorSystem.getLocalReceptionist().lookup(childLocator) ?? this.actorSystem.getReceptionist().lookup(childLocator);
    }
    return this.#children[childActorName];
  }

  async tell(messageType, message) {
    messageType = messageType ?? 'default';
    if (this.getQueue) {
      // Local actor. Let's do this!
      var queueMsg = new Message(messageType, message);
      this.getQueue().enqueue(queueMsg);
      return;
    }
    try {
      var client = util.getClient(this.host.getIdentifier());
      message = JSON.stringify(message);
      await nodeUtil.promisify(client.enqueue).bind(client)({ locator: this.locator, messageType: messageType, message: message, actionType: Constants.ACTION_TYPES.TELL });
    } catch (reason) {
      var msg = 'Queueing to' + this.locator + ' failed because of this reason:' + reason;
      logger.error(msg);
      throw new QueueingException(msg);
    }
  }

  async ask(messageType, message, callback) {
    if (!callback) {
      throw new QueueingException('callback is needed for ask requests.');
    }
    messageType = messageType ?? 'default';
    if (this.getQueue) {
      // Local actor. Let's do this!
      var queueMsg = new Message(messageType, message, callback);
      this.getQueue().enqueue(queueMsg);
      return;
    }
    try {
      var client = util.getClient(this.host.getIdentifier());
      message = JSON.stringify(message);
      var response = await nodeUtil.promisify(client.enqueue).bind(client)({ locator: this.locator, messageType: messageType, message: message, actionType: Constants.ACTION_TYPES.ASK });
      // callback if there's a callback. That will be there if it's an ask call and not a tell call.
      callback(response.err, response.result);
    } catch (reason) {
      var msg = 'Queueing to' + this.locator + ' failed because of this reason:' + reason;
      logger.error(msg);
      throw new QueueingException(msg);
    }
  }

  async getParent() {
    if (this.locator === Constants.ROOT_LOC) {
      return null;
    }
    return this.actorSystem.getLocalReceptionist().lookup(this.#getParentLocator(this.locator))
      ?? this.actorSystem.getReceptionist().lookup(this.#getParentLocator(this.locator))
      ?? this.actorSystem.getReceptionist().lookupWithLeader(this.#getParentLocator(this.locator));
  }

  #getParentLocator() {
    var locatorParts = this.locator.split('/');
    var parentLocator = '';
    for (var i = 0; i < locatorParts.length - 1; i++) {
      parentLocator = parentLocator.concat(locatorParts[i]);
      if (i < locatorParts.length - 2) {
        parentLocator = parentLocator.concat('/');
      }
    }
    return parentLocator;
  }

  serialize() {
    var obj = {};
    obj.name = this.name;
    obj.locator = this.locator;
    obj.actorUrl = this.actorUrl;
    obj.children = {};

    if (this.locator === Constants.ROOT_LOC) {
      for (var rootChild of Object.keys(this.#children)) {
        obj.children[rootChild] = this.#children[rootChild].serialize();
      }
    } else {
      var children = this.actorSystem.getReceptionist().getChildrenRefs(this.locator);
      for (var child of Object.keys(children)) {
        obj.children[child] = children[child].serialize();
      }
    }
    return obj;
  }
}
