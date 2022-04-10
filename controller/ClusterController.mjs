import getUtilInstance from "../util/Util.mjs";

const util = getUtilInstance();

export default (app, actorSystem, nodeDetails) => {

  app.get('/', (_req, res) => {
    // #swagger.tags = ['Node']
    // #swagger.summary = "Tells the Node's details"
    // RSS Memory usage Keeps increasing. We may need to go with a different memory allocation shared object for this, as stated here:
    // https://github.com/nodejs/help/issues/1518#issuecomment-991798619
    res.send(Object.assign(nodeDetails, { status: 'Running' }, { leader: actorSystem.getClusterManager().getLeaderManager().getCurrentLeader() },
      { memoryFootprint: util.getMemoryFootprint() }, { nodes: actorSystem.getClusterManager().getHosts() }));
  });

  app.get('/ready', (_req, res) => {
    // #swagger.tags = ['Node']
    // #swagger.summary = "Tells a Node's readiness status"
    res.send({ status: 'OK' });
  });

  app.post('/election', async (req, res) => {
    // #swagger.tags = ['Node']
    // #swagger.summary = "Tells a Node's readiness status"

    // At the beginning, I gotta ask for election.
    // I'll tell the other nodes my priority. They'll tell which node that they know of has the least priority.
    // Whichever node has the least priority is the leader.
    // I ping the leader. If it's up, it's the leader.
    actorSystem.getClusterManager().getLeaderManager().addOrUpdateNode(req.body.host, req.body.port, req.body.priority);
    await actorSystem.getClusterManager().getLeaderManager().checkAndUpdateLeaderStatus();
    res.send(actorSystem.getClusterManager().getLeaderManager().getCurrentLeader());
  });

  app.get('/actors', async (_req, res) => {
    // #swagger.tags = ['Node']
    // #swagger.summary = 'Returns all the actors and hierarchy in this node'
    if (actorSystem.getClusterManager().iAmLeader()) {
      var rootActor = await actorSystem.getRootActor();
      res.send(rootActor.getSerialized());
    } else {
      res.redirect(actorSystem.getClusterManager().getLeaderManager().getCurrentLeader().getBaseUrl().concat('/actors'));
    }
  });
}
