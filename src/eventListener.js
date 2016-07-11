import chalk        from 'chalk';
import libxmljs     from 'libxmljs';
import chokidar     from 'chokidar';

import utils        from './utils';
import logger       from './logger';
import crypto       from './crypto';
import world        from './world';

export default class {
  constructor(server){
    this.server   = server;
    this.database = server.database;
    this.handlers = {
      'verChk': 'handleVersionCheck',
      'rndK'  : 'handleRandomKey',
      'login' : 'handleLogin'
    }

    // packet: timeout in seconds
    this.throttle = {
      'u#sf': 2,
      'u#sa': 3,
      'u#sb': 2,
      'u#se': 2,
      'u#ss': 3,
      'u#sj': 3,
      'u#sg': 5
    }

    if(server.type == 'world'){
      this.world        = new world(server);
      this.server.world = this.world;

      this.watch();
    }
  }

  watch(directory){
    logger.debug(`Hotloading enabled, watching for code changes...`);

    let modules = {};

    chokidar.watch('./build', {alwaysStat: true}).on('all', (event, path, stats) => {
      if(event == 'add') modules[path] = {size: stats.size};
      if(event == 'change'){
        if(modules[path].size !== stats.size){
          logger.debug(`Reloaded code for ${path}...`);
          modules[path].size = stats.size;
          delete require.cache[path];
        }
      }
    });
  }

  handleVersionCheck(data, client){
    client.send('<msg t="sys"><body action="apiOK" r="0"></body></msg>');
  }

  handleRandomKey(data, client){
    client.randomKey = crypto.generateKey();
    client.send('<msg t="sys"><body action="rndK" r="-1"><k>' + client.randomKey + '</k></body></msg>');
  }

  handleLogin(data, client){
    require('./handlers/handleLogin.js')(data, client, this.server);
  }

  parseData(data, client){
    logger.debug('incoming: ' + data);

    const isGame = ((data.charAt(0) == '<') ? false : true);

    if(!isGame){
      if(data === '<policy-file-request/>'){
        client.send('<cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>');
      } else {
        const xml    = libxmljs.parseXml(data);
        const action = (xml.get('//body')).attr('action').value();
        const method = this.handlers[action];
        
        if(typeof this[method] == 'function'){
          this[method](data, client);
        }
      }
    } else {
      data = data.split('%');
      data.splice(0, 2);

      let allowed = ['g#ur', 'm#sm'];

      const world  = this.world;
      const split  = data[1].split('#');
      const type   = split[0],
            action = split[1];

      if((data.join('').includes('|') && !allowed.includes(data[1])) || (!client.id || !client.username)){
        client.sendError(800);
        return this.server.removeClient(client);
      }

      if(this.throttle[data[1]]){
        const packet  = data[1];
        const timeout = this.throttle[packet];

        if(!client.throttled)
          client.throttled = {};

        if(client.throttled[packet] && utils.getTimestamp() < client.throttled[packet])
          return;

        client.throttled[packet] = utils.getTimestamp() + timeout;
      }

      const gameManager = world.gameManager; // lazy
      
      if(gameManager.handlers[data[0]]){
        const gameHandler = gameManager.handlers[data[0]][data[1]];
        if(gameManager[gameHandler]){
          return gameManager[gameHandler](data, client);
        }
      }

      let handler = world.handlers[type] ?
                    world.handlers[type][action] :
                    world.handlers[action];

      if(handler && data !== undefined){
        world.do(handler, data, client);
      } else {
        logger.warn(`Missing handler for ${data[1]}`);
      }
    }
  }
}