export class NodeDetails {
  constructor(identifier, host, port, priority) {
    this.identifier = identifier;
    this.host = host;
    this.port = port;
    this.priority = priority;
  }

  getIdentifier() {
    return this.identifier;
  }

  getHost() {
    return this.host;
  }

  getPort() {
    return this.port;
  }
}