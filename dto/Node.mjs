import { randomUUID } from 'crypto';
import express from 'express';
import bodyParser from 'body-parser';
import log4js from 'log4js';
import clusterController from '../controller/ClusterController.mjs';
import nodeController from '../controller/NodeController.mjs';
import { NodeDetails } from './NodeDetails.mjs';
import ip from 'ip';

const logger = log4js.getLogger('Cluster');

export class Node {

  #actorSystem;
  #port;
  #priority;
  #nodeServer;
  #nodeDetails;

  constructor(actorSystem, port, priority) {
    this.#actorSystem = actorSystem;
    this.#port = port;
    this.#priority = priority;
  }

  startup() {
    this.#nodeServer = express();
    this.#nodeServer.use(bodyParser.urlencoded({ extended: false }));
    this.#nodeServer.use(bodyParser.json());
    this.#nodeDetails = new NodeDetails(randomUUID(), ip.address(), this.#port, this.#priority);
    clusterController(this.#nodeServer, this.#actorSystem, this.#nodeDetails);
    nodeController(this.#nodeServer, this.#actorSystem);
    this.#nodeServer.listen(this.#port, () => logger.info('Listening on', this.#port));
  }

  getNodeDetails() {
    return this.#nodeDetails;
  }

  shutdown() {
    this.#nodeServer.close(() => logger.debug('Server shutdown successfully!'));
  }
}
