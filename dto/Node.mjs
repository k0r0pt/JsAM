import { randomUUID } from 'crypto';
import express from 'express';
import bodyParser from 'body-parser';
import log4js from 'log4js';
import clusterController from '../controller/ClusterController.mjs';
import { NodeDetails } from './NodeDetails.mjs';
import NodeServer from '../grpc/service/NodeServer.mjs';
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
    this.#nodeServer.on('connection', socket => {
      logger.isDebugEnabled() && logger.debug('Setting timeout to 5 minutes.');
      socket.setTimeout(300 * 1000)
    });
    this.#nodeServer.use(bodyParser.urlencoded({ extended: false }));
    this.#nodeServer.use(bodyParser.json());
    this.#nodeDetails = new NodeDetails(randomUUID(), ip.address(), this.#port, this.#priority);
    clusterController(this.#nodeServer, this.#actorSystem, this.#nodeDetails);
    logger.info('Management Server Listening on', this.#port + 1);
    var nodeServer = NodeServer(this.#actorSystem, this.#port);
    nodeServer.init();
    this.#nodeServer.listen(this.#port + 1, () => logger.info('Node Server Listening on', this.#port));
  }

  getNodeDetails() {
    return this.#nodeDetails;
  }

  shutdown() {
    this.#nodeServer.close(() => logger.debug('Server shutdown successfully!'));
  }
}
