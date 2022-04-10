import NodeServer from './NodeServer.mjs';
import fs from 'fs';
import getUtilInstance from '../../util/Util.mjs';

const util = getUtilInstance();

export default function LocalNodeServer(thisActorSystem, myPort) {
  const SOCKETFILE = util.getSocketFile(myPort);

  var nodeServer = NodeServer.bind(NodeServer)(thisActorSystem, myPort);

  function createServer(socket) {
    console.log('Creating server.');
    return net.createServer(function (stream) {
      console.log('Connection acknowledged.');

      // Store all connections so we can terminate them if the server closes.
      // An object is better than an array for these.
      var self = Date.now();
      connections[self] = (stream);
      stream.on('end', function () {
        console.log('Client disconnected.');
        delete connections[self];
      });

      // Messages are buffers. use toString
      stream.on('data', function (msg) {
        nodeServer[msg.method].apply(nodeServer, [{ request: msg.request }, (err, res) => {
          process.send(JSON.stringify({ err: err, res: res }));
        }]);
      });
    }).listen(socket);
  }

  fs.stat(SOCKETFILE, function (err, _stats) {
    if (err) {
      // start server
      console.log('No leftover socket found.');
      createServer(SOCKETFILE);
      return;
    }
    // remove file then start server
    console.log('Removing leftover socket.')
    fs.unlink(SOCKETFILE, function (_err) {
      if (_err) {
        // This should never happen.
        console.error(_err);
        process.exit(0);
      }
      createServer(SOCKETFILE);
    });
  });
}
