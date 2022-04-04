export class Cluster {

  /**
   * An Array of IPs/Hostnames that are part of this cluster.
   *
   * @param {Array} hosts The hosts in the cluster
   */
  constructor(hosts) {
    this.hosts = hosts;
  }

  /**
   * Getter for the Hosts.
   *
   * @returns the clustered hosts
   */
  getHosts() {
    return this.hosts;
  }
}