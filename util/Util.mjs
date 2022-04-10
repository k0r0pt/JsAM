import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

class Util {

  #grpcConnectionPool = {};
  #packageDefinition = protoLoader.loadSync('NodeService.proto', { keepCase: true, longs: Number, enums: String, defaults: true, oneofs: true, includeDirs: ['grpc/protobuf'] });
  #nodeService = grpc.loadPackageDefinition(this.#packageDefinition).org.coreops;

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
      for (var i = 0; i < 1000; i++) {
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
}

const singletonInstance = new Util();

export default function util() { return singletonInstance }
