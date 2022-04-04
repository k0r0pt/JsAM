import axios from 'axios';
import log4js from 'log4js';
import { Actor } from '../actor/system/Actor.mjs';
import { ActorRef } from '../actor/system/ActorRef.mjs';
import { ClusterManager } from '../manager/ClusterManager.mjs';

const logger = log4js.getLogger('Receptionist');

export class Receptionist {

  /**
   * The lookup table.
   */
  #lut = {};

  /**
   * Constructor.
   *
   * @param {ClusterManager} clusterManager The Cluster Manager
   */
  constructor(clusterManager) {
    this.clusterManager = clusterManager;
  }

  lookup(locator) {
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

  /**
   * Synchronizes all nodes with the details of the created {@link ../actor/system/Actor.mjs}.
   *
   * @param {Actor} actor The Actor that needs to be synced.
   */
  async syncRegistration(actor) {
    for (var host of this.clusterManager.getHosts()) {
      if (host === this.clusterManager.getMe()) {
        continue;
      }
      var url = host.getBaseUrl() + '/actorSystem/receptionist/ack/registration';
      this.#lut[actor.getLocator()] = actor;
      try {
        await axios.post(url, { name: actor.getName(), locator: actor.getLocator(), actorUrl: actor.getActorUrl() });
      } catch (reason) {
        logger.error('Sync Actor Registration failed for ', url, 'with reason:', reason.code);
      }
    }
  }

  /**
   * Registers remote {@link ActorRef}.
   *
   * @param {ActorRef} actorRef The Actor Reference to keep in the loookup table
   */
  async registerRemoteActor(actorRef) {
    this.#lut[actorRef.getLocator()] = actorRef;
  }
}