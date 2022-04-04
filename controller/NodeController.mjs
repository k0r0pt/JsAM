import { ActorRef } from '../actor/system/ActorRef.mjs';
import { Message } from '../dto/Message.mjs';
import { FunctionSerDeser } from '../serialization/FunctionSerializerDeserializer.mjs';
import nodeUtil from 'util';
import log4js from 'log4js';

const logger = log4js.getLogger('NodeController');

export default (app, actorSystem) => {

  const thisActorSystem = actorSystem;

  app.put('/actorSystem/actor/:actorLocator', (req, res) => {
    // #swagger.tags = ['Actors']
    // #swagger.summary = "Puts a message to an actor's queue"
    var actorLocator = req.params.actorLocator;
    var messageType = req.body.messageType;
    var message = req.body.message;
    var localActor = thisActorSystem.getLocalReceptionist().lookup(actorLocator)
    if (!localActor) {
      return res.sendStatus(404).send('Actor not found.');
    }

    localActor.getQueue().enqueue(new Message(messageType, message));
    res.send('enqueued.');
  });

  app.post('/actorSystem/leader/create/actor/:actorLocator', async (req, res) => {
    // #swagger.tags = ['Actors', 'Leaders']
    // #swagger.summary = "Creates an actor if this is a leader node. Or asks leader to create the actor."
    var actorLocator = req.params.actorLocator;
    var locatorParts = actorLocator.split('/');
    var actorName = locatorParts[locatorParts.length - 1];
    var behaviorDefinition = req.body.behaviorDefinition;
    var errorHandler = req.body.errorHandler && FunctionSerDeser.deserialize(req.body.errorHandler);
    var clusterManager = thisActorSystem.getClusterManager();
    var createdActor = await nodeUtil.promisify(clusterManager.createActor).bind(clusterManager)(actorName, actorLocator, behaviorDefinition, errorHandler);
    logger.debug('Actor Created', createdActor.getName());
    res.send({ actorUrl: createdActor.getActorUrl() });
  });

  app.post('/actorSystem/actor/:actorLocator', (req, res) => {
    // #swagger.tags = ['Actors']
    // #swagger.summary = "Creates an actor"
    var actorLocator = req.params.actorLocator;
    var locatorParts = actorLocator.split('/');
    var actorName = locatorParts[locatorParts.length - 1];
    var behaviorDefinition = req.body.behaviorDefinition;
    var errorHandler = req.body.errorHandler && FunctionSerDeser.deserialize(req.body.errorHandler);
    thisActorSystem.getClusterManager().createLocalActor(actorName, actorLocator, behaviorDefinition, errorHandler);
    res.send('done');
  });

  app.post('/actorSystem/receptionist/ack/registration', (req, res) => {
    // #swagger.tags = ['Actors']
    // #swagger.sumamry = 'Syncs the node receptionist for actor registration'
    thisActorSystem.getReceptionist().registerRemoteActor(new ActorRef(thisActorSystem, req.body.name, req.body.locator, req.body.actorUrl));
    res.send('done');
  });
}