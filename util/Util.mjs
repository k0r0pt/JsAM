import grpc, { Metadata } from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

class Util {

  #grpcConnectionPool = {};
  #packageDefinition = protoLoader.loadSync('NodeService.proto', { keepCase: true, longs: Number, enums: String, defaults: true, oneofs: true, includeDirs: ['node_modules/@k0r0pt/jsam/grpc/protobuf', 'grpc/protobuf'] });
  #nodeService = grpc.loadPackageDefinition(this.#packageDefinition).org.coreops;
  #pingClientMap = {};
  #createActorAsLeaderCallMap = {};
  #createLocalActorCallMap = {};

  getSocketFile(port) {
    port = port.includes(':') ? port.split(':')[1] : port;
    return '/var/run/jSAM.'.concat(port).concat('.sock');
  }

  getMemoryFootprint() {
    var footprint = {};
    for (const [key, value] of Object.entries(process.memoryUsage())) {
      footprint[key] = `${value / (1024 * 1024)} MB`;
    }
    return footprint;
  }

  getNodeService() {
    return this.#nodeService;
  }

  #initGrpcConnPool(node) {
    if (!this.#grpcConnectionPool[node]) {
      this.#grpcConnectionPool[node] = {};
      this.#grpcConnectionPool[node].next = 0;
      this.#grpcConnectionPool[node].getConnection = function () {
        return this.pool[this.next];
      }
      this.#grpcConnectionPool[node].nextClient = 0;
      this.#grpcConnectionPool[node].pool = [];
      // Let's do a thousand clients per node.
      for (var i = 0; i < 10; i++) {
        this.#grpcConnectionPool[node].pool.push(new this.#nodeService.NodeService(node, grpc.credentials.createInsecure()));
      }
    }
  }

  getClient(node) {
    // TODO If GRPC-js finally starts supporting UDS, we can do Unix Sockets.
    // Otherwise, If we find a way of doing Unix socket synchronously, we'll use LocalNodeServer.
    // Till then, we'll have to stick with GRPC over HTTP2. 
    this.#initGrpcConnPool(node);
    // Round Robin strategy.
    var next = (this.#grpcConnectionPool[node].next + 1) % this.#grpcConnectionPool[node].pool.length;
    var conn = this.#grpcConnectionPool[node].getConnection()
    this.#grpcConnectionPool[node].next = next;
    return conn;
  }

  getPingClient(node) {
    if (!this.#pingClientMap[node]) {
      this.#pingClientMap[node] = new this.#nodeService.NodeService(node, grpc.credentials.createInsecure());
    }
    return this.#pingClientMap[node];
  }

  /**
   * Returns a GRPC Stream call which will be used to ask leader to create Actors.
   *
   * @param {string} node The leader node identifier
   * @param {Function} callback The callback to be called when data is received. This will only be defined once.
   * @param {Function} errorCallback The callback to be called error is received. This will only be defined once.
   * @returns The Grpc Stream call
   */
  getCreateActorAsLeaderCall(node, callback, errorCallback) {
    if (!this.#createActorAsLeaderCallMap[node]) {
      var client = new this.#nodeService.NodeService(node, grpc.credentials.createInsecure());
      var metadata = new Metadata();
      metadata.set('node', node);
      this.#createActorAsLeaderCallMap[node] = client.createActorAsLeader(metadata, { node: node });
      this.#createActorAsLeaderCallMap[node].on('data', data => {
        callback(data, node);
      });
      this.#createActorAsLeaderCallMap[node].on('end', () => {
        console.log('Ending client stream for createActorAsLeader call.');
        this.#createActorAsLeaderCallMap[node] && this.#createActorAsLeaderCallMap[node].end();
        delete this.#createActorAsLeaderCallMap[node];
      });
      this.#createActorAsLeaderCallMap[node].on('error', reason => {
        console.log('Ending client stream for createActorAsLeader call because of error.');
        this.#createActorAsLeaderCallMap[node] && this.#createActorAsLeaderCallMap[node].end();
        delete this.#createActorAsLeaderCallMap[node];
        errorCallback(reason, node);
      });
    }
    return this.#createActorAsLeaderCallMap[node];
  }

  /**
   * Returns a GRPC Stream call which will be used to ask node to create local Actors.
   *
   * @param {string} node The node identifier
   * @param {Function} callback The callback to be called when data is received. This will only be defined once.
   * @param {Function} errorCallback The callback to be called error is received. This will only be defined once.
   * @returns The Grpc Stream call
   */
  getCreateLocalActorCall(node, callback, errorCallback) {
    if (!this.#createLocalActorCallMap[node]) {
      var client = new this.#nodeService.NodeService(node, grpc.credentials.createInsecure());
      var metadata = new Metadata();
      metadata.set('node', node);
      this.#createLocalActorCallMap[node] = client.createLocalActor(metadata, { node: node });
      this.#createLocalActorCallMap[node].on('data', data => {
        callback(data, node);
      });
      this.#createLocalActorCallMap[node].on('end', () => {
        console.log('Ending client stream for createLocalActor call.');
        this.#createLocalActorCallMap[node] && this.#createLocalActorCallMap[node].end();
        delete this.#createLocalActorCallMap[node];
      });
      this.#createLocalActorCallMap[node].on('error', reason => {
        console.log('Ending client stream for createLocalActor call because of error.');
        this.#createLocalActorCallMap[node] && this.#createLocalActorCallMap[node].end();
        delete this.#createLocalActorCallMap[node];
        errorCallback(reason, node);
      });
    }
    return this.#createLocalActorCallMap[node];
  }
}

const singletonInstance = new Util();

export default function util() { return singletonInstance }
