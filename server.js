// server.js
// where your node app starts

// init project
const express = require('express');
const app = express();
const fetch = require("node-fetch")
const request = require("request")
const fs = require("fs")
const LocalStorage = require("node-localstorage").LocalStorage;

//ls
if (typeof localStorage === "undefined" || localStorage === null) {
    localStorage = new LocalStorage('./scratch');
}

//create required directories
["./tmp"].forEach(async dir => {
    fs.existsSync(dir) || fs.mkdirSync(dir);
});

const getDate = () => {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '')
};

const getHour = () => {
  return `${getDate()}${new Date().toISOString().split("T")[1].slice(0, 2)}`;
}

const quota = {
    hourly: 40,
    set: (c) => {
        localStorage.setItem('quota', c);
    },
    reset: () => {
      localStorage.setItem('quota', 0);
    },
    get: () => {
        return localStorage.getItem('quota')
    },
    add: () => {
        let c = localStorage.getItem('quota');
        localStorage.setItem('quota', (+c) + 1);
    },
    substract: () => {
        let c = localStorage.getItem('quota');
        localStorage.setItem('quota', (+c) - 1);
    }
}

app.use(express.static('public'));

app.get('/', function(request, response) {
    response.sendFile(__dirname + '/views/index.html');
});

// listen for requests :)
const listener = app.listen(process.env.PORT, function() {
    console.log('Your app is listening on port ' + listener.address().port);
});

const get = async (song) => new Promise((resolve, reject) => {
    request({
        url: `https://${process.env.HOST}/composition/play`,
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'Authorization': process.env.TOKEN
        },
        json: {
            compositionID: song._id
        }
    }).on('response', async file => {
      
        console.log(`[TMP] Writing °${song.name}° to disk...`);
      
        var stream= file.pipe(fs.createWriteStream(`tmp/${song.name}.mp3`));

        stream.on("error", (err) => {
            reject(err);
        });
        stream.on("finish", async () => {

            console.log(`[TMP] Written ${song.name} to disk...`);
          
            await upload({
                host: process.env.FTP_HOST,
                port: 21,
                user: process.env.FTP_USER,
                password: process.env.FTP_PASS,
            }, `tmp/${song.name}.mp3`, `${getDate()}/${song.name}.mp3`);
            resolve();
        });
    })
});


//************ FTP custom (requires 'ftp')
const upload = async (credentials, pathToLocalFile, pathToRemoteFile) => new Promise((resolve, reject) => {
    var Client = require('ftp');
    var options = {
        host: credentials.host,
        port: credentials.port,
        user: credentials.user,
        password: credentials.password
    };
    var c = new Client();
    //on client ready, upload the file.
    c.on('ready', () => {
        console.log(`[FTP] upload of ${pathToLocalFile} began...`)
        c.put(pathToLocalFile, pathToRemoteFile, function(err) {
            c.end(); //end client
            fs.unlink(pathToLocalFile, (error) => {
                /* handle error */
            });
            console.log(`[FTP] Upload completed: ${pathToLocalFile} => ${pathToRemoteFile}`)
            if (err) reject(err); //reject promise
            resolve(); //fullfill promise
        });
    });
    //general error
    c.on('error', (err) => {
        return reject(err);
    });
    c.connect(options);
});

const deleteSong = (song => new Promise(async (resolve, reject) => {
    request({
        url: `https://${process.env.HOST}/composition/delete`,
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'Authorization': process.env.TOKEN
        },
        json: {
            compositionID: song._id
        }
    }, (error, response, result) => {

        if (error === null) {
            console.log(`[AI] °${song.name}° was deleted on generating server.`);
            resolve();
        } else {
            console.error(error);
            return reject(error);
        }
    });
}));
const create = () => new Promise(async (resolve, reject) => {
    if (quota.get() < quota.hourly)
        request({
            url: `https://${process.env.HOST}/composition/original/createFromPreset`,
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'Authorization': process.env.TOKEN
            },
            json: {
                duration: "auto",
                ensemble: "auto",
                folderID: "",
                includeDrums: true,
                includeTempoMap: true,
                key: "auto",
                numberOfCompositions: "1",
                pacing: "auto",
                preset: "fantasy",
                timeSignature: "auto",
                token: process.env.TOKEN
            }
        }, (error, response, body) => {
            if (error === null) {
                const song = body.compositions[0];
                console.log(`[AI] #${song._id} (${song.name}) is getting created...`);
                quota.add();
                resolve();
            } else {
                console.error(`[WARNING] ${error}`);
                return reject(error);
            }
        });
    else {
      console.log("[WARNING] Hourly quota reached.");
       setTimeout(() => {
         quota.reset();
         
       }, 1000 * 60 * (60));
    }
});

const pumpSongs = () => {

    console.log(`[PUMPER] Refreshing state... [Creation Quota: ${quota.get()}/${quota.hourly} for hour ${getHour()}]`)

    request({
        url: `https://${process.env.HOST}/folder/getContent`,
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'Authorization': process.env.TOKEN
        },
        json: {
            folderID: "",
            getSharedContent: false,
            token: process.env.TOKEN
        }
    }, async (error, res, json) => {
        console.log("[PUMPER] Processing songs...")
        var i = 0;
        if (json.compositions && json.compositions.length > 0) {
            //Songs löschen
            for (var key in json.compositions) {
                const song = json.compositions[key];
                console.log(`[AI] deleting °${song.name}°...`)

                if (song.isFinished) { //done
                    await get(song);
                    await deleteSong(song);
                    i++;

                    if (i === json.compositions) {
                        console.log("[PUMPER] Songs have been updated.");
                        setTimeout(pumpSongs, 9999);
                    }
                }
            }
        } else create(); //create new if not existing
    });
};

setTimeout(pumpSongs, 9999);