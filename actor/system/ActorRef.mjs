import log4js from 'log4js';
import { Constants } from '../../constants/Constants.mjs';
import { Message } from '../../dto/Message.mjs';
import { QueueingException } from '../../exception/QueueingException.mjs';
import nodeUtil from 'util';
import getUtilInstance from '../../util/Util.mjs';
import { ActorCreationException } from '../../exception/ActorCreationException.mjs';
import { DummyActorRef } from './DummyActorRef.mjs';

const logger = log4js.getLogger('ActorRef');
const util = getUtilInstance();

export class ActorRef extends DummyActorRef {

  /**
   * The {@link ActorRef} Map of this actor's children.
   */
  #children = {};
  #retries = {};

  /**
   * The Constructor.
   *
   * @param {ActorSystem} actorSystem The Actor System
   * @param {string} name The actor name
   * @param {string} locator The actor locator in the Actor System
   * @param {string} actorUrl The Url for the actor
   * @param {string} behaviorDefinition The actor Behavior Definition file
   */
  constructor(actorSystem, name, locator, actorUrl, behaviorDefinition) {
    super(name, locator, behaviorDefinition);
    this.actorSystem = actorSystem;
    this.actorUrl = actorUrl;
    this.host = actorSystem.getClusterManager().resolveToHost(this.actorUrl);
  }

  getActorUrl() {
    return this.actorUrl;
  }

  getActorSystem() {
    return this.actorSystem;
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

  updateChildRef(childActor) {
    this.#children[childActor.name] = childActor;
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

  removeChild(childLocator) {
    var locatorParts = childLocator.split('/');
    var childActorName = locatorParts[locatorParts.length - 1];
    delete this.#children[childActorName];
  }

  async tell(messageType, message) {
    messageType = messageType ?? 'default';
    if (this.getQueue && this.getQueue()) {
      // Local actor. Let's do this!
      var queueMsg = new Message(messageType, message);
      this.getQueue().enqueue(queueMsg);
      return;
    }
    message = JSON.stringify(message);
    var retryKey = this.locator + messageType + message + Constants.ACTION_TYPES.TELL;
    try {
      var requestMsg = { locator: this.locator, messageType: messageType, message: message, actionType: Constants.ACTION_TYPES.TELL };
      var client = util.getClient(this.host.getIdentifier());
      await nodeUtil.promisify(client.enqueue).bind(client)(requestMsg);
    } catch (reason) {
      if (this.#retries[retryKey] === 3) {
        delete this.#retries[retryKey];
        var msg = 'Queueing to ' + this.actorUrl + ' failed because of this reason:' + reason;
        logger.error(msg);
        throw new QueueingException(msg);
      }
      if (this.#retries[retryKey] > 0) {
        // I may no longer be in the same place.
        // As in the node I'm in may have gone down, in which case my receptionist will know where I am.
        var myNewRef = this.actorSystem.getReceptionist().lookup(this.locator);
        if (!myNewRef || myNewRef.actorUrl === this.actorUrl) {
          myNewRef = await this.actorSystem.getReceptionist().lookupWithLeader(this.locator);
        }
        if (myNewRef.actorUrl !== this.actorUrl) {
          logger.debug('I have moved... Forwarding the tell to my new reference. And then telling my parent to update my reference.', myNewRef);
          myNewRef.tell(messageType, JSON.parse(message));
          (await this.getParent()).updateChildRef(myNewRef);
          return;
        }
      }
      logger.error('Retrying Queueing to', this.locator);
      this.#retries[retryKey] = this.#retries[retryKey] !== undefined ? this.#retries[retryKey] + 1 : 1;
      var self = this;
      // Backoff incrementally by a second there.
      setTimeout(async () => self.tell.bind(self)(messageType, JSON.parse(message)), this.#retries[retryKey] * 1000 * process.env.OP_RETRY_INTERVAL);
    }
  }

  async ask(messageType, message, timeout, prioritize, callback) {
    if (typeof prioritize === 'function') {
      callback = prioritize;
      prioritize = false;
    }
    if (typeof timeout === 'function') {
      callback = timeout;
      timeout = undefined;
    }
    timeout = timeout ?? (process.env.JSAM_ASK_TIMEOUT ? parseInt(process.env.JSAM_ASK_TIMEOUT) : undefined);
    if (!callback) {
      throw new QueueingException('callback is needed for ask requests.');
    }
    messageType = messageType ?? 'default';
    if (this.getQueue && this.getQueue()) {
      // Local actor. Let's do this!
      var queueMsg = new Message(messageType, message, callback);
      this.getQueue().enqueue(queueMsg, prioritize);
      return;
    }
    message = JSON.stringify(message);
    var retryKey = this.locator + messageType + message + Constants.ACTION_TYPES.ASK;
    try {
      var client = util.getClient(this.host.getIdentifier());
      var deadlineOpts = undefined;
      if (timeout) {
        deadlineOpts = { deadline: timeout };
      }
      var response = await nodeUtil.promisify(client.enqueue).bind(client)({ locator: this.locator, messageType: messageType, message: message, prioritize: prioritize, actionType: Constants.ACTION_TYPES.ASK }, deadlineOpts);
      // callback if there's a callback. That will be there if it's an ask call and not a tell call.
      messageType === Constants.TRANSFER_REQUEST_MSG_TYPE && logger.info('Transfer ask response:', response);
      callback(JSON.parse(response.err), JSON.parse(response.result));
    } catch (reason) {
      if (this.#retries[retryKey] === 3) {
        delete this.#retries[retryKey];
        var msg = 'Queueing to ' + this.actorUrl + ' failed because of this reason:' + reason;
        logger.error(msg);
        throw new QueueingException(msg);
      }
      if (this.#retries[retryKey] > 0) {
        // I may no longer be in the same place.
        // As in the node I'm in may have gone down, in which case my receptionist will know where I am.
        var myNewRef = this.actorSystem.getReceptionist().lookup(this.locator);
        if (!myNewRef || myNewRef.actorUrl === this.actorUrl) {
          myNewRef = await this.actorSystem.getReceptionist().lookupWithLeader(this.locator);
        }
        if (myNewRef.actorUrl !== this.actorUrl) {
          logger.debug('I have moved... Forwarding the tell to my new reference. And then telling my parent to update my reference.', myNewRef);
          myNewRef.ask(messageType, JSON.parse(message), prioritize, callback);
          (await this.getParent()).updateChildRef(myNewRef);
          return;
        }
      }
      logger.error('Retrying Queueing to', this.locator);
      this.#retries[retryKey] = this.#retries[retryKey] !== undefined ? this.#retries[retryKey] + 1 : 1;
      var self = this;
      // Backoff incrementally by a second there.
      setTimeout(async () => self.ask.bind(self)(messageType, JSON.parse(message), prioritize, callback), this.#retries[retryKey] * 1000 * process.env.OP_RETRY_INTERVAL);
    }
  }

  async getParent() {
    if (this.locator === Constants.ROOT_LOC) {
      return null;
    }

    var parentLocator = this.#getParentLocator(this.locator);
    logger.debug('Parent Locator:', parentLocator)
    if (parentLocator.concat('/') === Constants.ROOT_LOC) {
      return this.actorSystem.getRootActor();
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

    var children = this.actorSystem.getReceptionist().getChildrenRefs(this.locator);
    for (var child of Object.keys(children)) {
      obj.children[child] = children[child].serialize();
    }
    return obj;
  }
}
