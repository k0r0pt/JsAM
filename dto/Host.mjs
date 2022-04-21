/**
 * The Host Descriptor class.
 */
export class Host {

  /**
   * Constructor.
   *
   * @param {string} host The hostname of the Host
   * @param {number} port The port of the Host
   */
  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.status = null;
    this.priority = null;
  }

  getHost() {
    return this.host;
  }

  getPort() {
    return this.port;
  }

  getStatus() {
    return this.status;
  }

  getPriority() {
    return this.priority;
  }

  setPriority(priority) {
    this.priority = priority;
  }

  getIdentifier() {
    return this.host + ':' + this.port;
  }

  getBaseUrl() {
    return 'http://' + this.getIdentifier();
  }

  getClusterBaseUrl() {
    return 'http://' + this.getHost() + ':' + (this.getPort() + 1);
  }
}