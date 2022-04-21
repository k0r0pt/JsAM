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

  app.get('/actors', async (_req, res) => {
    // #swagger.tags = ['Node']
    // #swagger.summary = 'Returns all the actors and hierarchy in this node'
    if (actorSystem.getClusterManager().iAmLeader()) {
      var rootActor = await actorSystem.getRootActor();
      res.send(rootActor.serialize());
    } else {
      res.redirect(actorSystem.getClusterManager().getLeaderManager().getCurrentLeader().getClusterBaseUrl().concat('/actors'));
    }
  });
}
