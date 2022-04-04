import axios from 'axios';
import log4js from 'log4js';
import { Host } from '../dto/Host.mjs';

const logger = log4js.getLogger('LeaderManager');

export class LeaderManager {

  constructor(me, clusterManager) {
    this.me = me;
    this.clusterManager = clusterManager;
  }

  electLeader() {
    var self = this;
    this.clusterManager.getHosts().filter(host => !(host.getHost() === self.me.getHost() && host.getPort() === self.me.getPort())).forEach(host => sendElectionMsg(host, self));
  }

  addOrUpdateNode(host, port, priority) {
    var matchingHosts = this.clusterManager.getHosts().filter(existingHost => existingHost.getHost() === host && existingHost.getPort() === port);
    if (matchingHosts.length !== 1) {
      // We (hopefully) won't have a scenario where this will be more than 1.
      var hostObj = new Host(host, port);
      hostObj.setPriority(priority);
      this.clusterManager.addHost(hostObj);
    } else {
      this.updateNode(host, port, priority);
    }
  }

  updateNode(host, port, priority) {
    var matchingHost = this.clusterManager.getHosts().find(existingHost => existingHost.getHost() === host && existingHost.getPort() === port);
    matchingHost && matchingHost.setPriority(priority);
  }

  /**
   * Returns the current leader of the cluster.
   *
   * @returns The {@link Host} that is the current leader
   */
  getCurrentLeader() {
    return this.clusterManager.getHosts().reduce((prev, current) => {
      if (prev && prev.getPriority()) {
        if (current && current.getPriority()) {
          if (prev.getPriority() <= current.getPriority()) {
            return prev;
          } else {
            return current;
          }
        } else {
          return prev;
        }
      } else {
        return current;
      }
    }, null);
  }

  async checkAndUpdateLeaderStatus() {
    var leaderIsUp;
    var currentLeader = this.getCurrentLeader();
    var url = currentLeader.getBaseUrl();
    try {
      await axios.get(url);
      leaderIsUp = true;
    } catch (reason) {
      logger.debug('Leader', url, 'went down!', reason.code)
      leaderIsUp = false;
    }
    if (!leaderIsUp) {
      this.clusterManager.removeHost(currentLeader);
      this.clusterManager.initLeaderElection();
    }
  }
}

function sendElectionMsg(host, self) {
  var url = host.getBaseUrl() + '/election';
  logger.debug('Querying for current leader:', url);
  axios.post(url, { host: self.me.host, port: self.me.port, priority: self.me.priority }).then(res => {
    logger.trace(res.status);
    logger.trace(res);
    self.updateNode(res.data.host, res.data.port, res.data.priority);
  }).catch(reason => {
    logger.error('Node', url, 'down during leader election. Removing...', reason.code)
    // Host is down. Let's remove it.
    self.clusterManager.removeHost(host);
  });
}
