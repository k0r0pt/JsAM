import log4js from 'log4js';
import { Actor } from '../actor/system/Actor.mjs';
import { ActorRef } from '../actor/system/ActorRef.mjs';
import { Queue } from '../ds/Queue.mjs';
import { ActorNotFoundException } from '../exception/ActorNotFoundException.mjs';
import { ClusterManager } from '../manager/ClusterManager.mjs';
import getUtilInstance from '../util/Util.mjs';
import nodeUtil from 'util';

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
    if (!this.#lut[locator]) {
      var leader = this.clusterManager.getLeaderManager().getCurrentLeader();
      try {
        var client = util.getClient(leader.getIdentifier());
        var res = nodeUtil.promisify(client.getActor).bind(client)({ locator: locator });
        this.#lut[locator] = new ActorRef(this.clusterManager.getActorSystem(), res.name, res.locator, res.actorUrl);
      } catch (reason) {
        logger.error('Error while trying to get actor with locator', locator, 'from the leader\' receptionist.', reason);
        throw new ActorNotFoundException('Actor with locator ' + locator + ' was not found on the leader\'s receptionist');
      }
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
      if (lutLocator.split('/').at(-2) === locator.split('/').at(-1)) {
        // This is a direct child's locator.
        var childActor = this.#lut[lutLocator];
        children[childActor.getName()] = childActor;
      }
    }
    return children;
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
}