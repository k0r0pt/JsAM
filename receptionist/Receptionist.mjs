import log4js from 'log4js';
import { Actor } from '../actor/system/Actor.mjs';
import { ActorRef } from '../actor/system/ActorRef.mjs';
import { Queue } from '../ds/Queue.mjs';
import { ActorNotFoundException } from '../exception/ActorNotFoundException.mjs';
import { ClusterManager } from '../manager/ClusterManager.mjs';
import getUtilInstance from '../util/Util.mjs';
import nodeUtil from 'util';
import { Constants } from '../constants/Constants.mjs';

const logger = log4js.getLogger('Receptionist');
const util = getUtilInstance();

export class Receptionist {

  /**
   * The lookup table.
   */
  #lut = {};
  #syncQueue = {};

  /**
   * Constructor.
   *
   * @param {ClusterManager} clusterManager The Cluster Manager
   */
  constructor(clusterManager) {
    this.clusterManager = clusterManager;
    this.#syncQueue = new Queue(this);
  }

  lookup(locator) {
    return this.#lut[locator];
  }

  async lookupWithLeader(locator) {
    // Make sure that we're going to the right leader.
    await nodeUtil.promisify(this.clusterManager.pingNodes).bind(this.clusterManager)();
    var leader = this.clusterManager.getLeaderManager().getCurrentLeader();
    try {
      var client = util.getClient(leader.getIdentifier());
      var res = await nodeUtil.promisify(client.getActor).bind(client)({ locator: locator });
      this.#lut[locator] = new ActorRef(this.clusterManager.getActorSystem(), res.name, res.locator, res.actorUrl, res.behaviorDefinition);
    } catch (reason) {
      logger.error('Error while trying to get actor with locator', locator, 'from the leader\' receptionist.', reason);
      throw new ActorNotFoundException('Actor with locator ' + locator + ' was not found on the leader\'s receptionist');
    }
    return this.#lut[locator];
  }

  lookupByName(actorName, callback) {
    var keysWithActorName = Object.keys(this.#lut).filter(key => key.endsWith(actorName));
    var matchingActors = [];
    for (var keyWithActorName of keysWithActorName) {
      matchingActors.push(this.#lut[keyWithActorName]);
    }
    callback(matchingActors);
  }

  getChildrenRefs(locator) {
    var children = {};
    for (var lutLocator of Object.keys(this.#lut)) {
      if ((locator === Constants.ROOT_LOC && (lutLocator.split('/').at(-2) + '/') === locator)
        || lutLocator.split('/').at(-2) === locator.split('/').at(-1)) {
        // This is a direct child's locator.
        var childActor = this.#lut[lutLocator];
        children[childActor.getName()] = childActor;
      }
    }
    return children;
  }

  getParentRef(locator) {
    var parentLocator = locator.substring(0, locator.lastIndexOf('/'));
    var parentRef = this.#lut[parentLocator];
    if (parentLocator === '-') {
      parentRef = this.clusterManager.getActorSystem().getRootActor();
    }
    return parentRef;
  }

  removeHosts(hosts) {
    if (hosts.length === 0) {
      return;
    }
    var locatorsToDelete = [];
    var deletedActors = [];
    var self = this;
    Object.keys(this.#lut).forEach(locator => {
      if (hosts.includes(self.#lut[locator].getHost())) {
        locatorsToDelete.push(locator);
      }
    });
    locatorsToDelete.forEach(async locator => {
      deletedActors.push(self.#lut[locator]);
      delete self.#lut[locator];
      logger.isTraceEnabled() && logger.trace('Deleted dead reference', locator);
      // Let's ask their parents, if we have them, to delete that child reference.
      var parent = self.getParentRef(locator);
      parent && parent.removeChild(locator);
    });
    return deletedActors;
  }

  /**
   * Synchronizes all nodes with the details of the created {@link ../actor/system/Actor.mjs}.
   *
   * @param {Actor} actor The Actor that needs to be synced.
   */
  async syncRegistration(actor) {
    this.#lut[actor.getLocator()] = actor;
  }

  /**
   * Registers remote {@link ActorRef}.
   *
   * @param {ActorRef} actorRef The Actor Reference to keep in the loookup table
   */
  registerRemoteActor(actorRef) {
    this.#lut[actorRef.getLocator()] = actorRef;
  }

  getActors() {
    var actors = [];
    Object.keys(this.#lut).forEach(locator => actors.push(this.#lut[locator]));
    return actors;
  }
}