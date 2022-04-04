import { Cluster } from './Cluster.mjs';
import { Node } from './Node.mjs';

export class FileBasedConfig {

  /**
   * Constructor.
   *
   * @param {Cluster} cluster The Cluster Definition
   * @param {Node} node The Node Definition
   */
  constructor(cluster, node) {
    this.cluster = cluster;
    this.node = node;
  }
}