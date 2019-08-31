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
const getHour = () =>{
  return `${getDate()}${new Date().toISOString().split("T")[1].slice(0, 2)}`;
}
const quota = {
    max: 40,
    set: (c) => {
        localStorage.setItem(`dls_${getHour()}`, c);
    },
    get: () => {
        return localStorage.getItem(`dls_${getHour()}`)
    },
    add: () => {
        let c = localStorage.getItem(`dls_${getHour()}`);
        localStorage.setItem(`dls_${getHour()}`, (+c) + 1);
    },
    substract: () => {
        let c = localStorage.getItem(`dls_${getHour()}`);
        localStorage.setItem(`dls_${getHour()}`, (+c) - 1);
    }
}

// http://expressjs.com/en/starter/static-files.html
app.use(express.static('public'));
// http://expressjs.com/en/starter/basic-routing.html
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
        console.log(`[DISK] Writing '${song.name}' to tmpdisk...`);
        var stream = file.pipe(fs.createWriteStream(`tmp/${song.name}.mp3`));
        stream.on("error", (err) => {
            reject(err);
        });
        stream.on("finish", async () => {
            console.log(`[DISK] Written ${song.name} to temporary dir...`);
            await upload({
                host: process.env.FTP_HOST,
                port: 21,
                user: process.env.FTP_USER,
                password: process.env.FTP_PASS,
            }, `tmp/${song.name}.mp3`, `${getDate()}/${song.name}.mp3`);
            resolve();
        });
    });
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
        console.log(`[FTP] uploading ${pathToLocalFile} => ${pathToRemoteFile}`)
        c.put(pathToLocalFile, pathToRemoteFile, function(err) {
            c.end(); //end client
            fs.unlink(pathToLocalFile, (error) => {
                /* handle error */
            });
            console.log(`[FTP] uploaded ${pathToLocalFile} => ${pathToRemoteFile}`)
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
//delete song
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
            console.log(`[AI] '${song.name}' was deleted.`);
            resolve();
        } else {
            console.error(error);
            return reject(error);
        }
    });
}));
//create a new song
const create = () => new Promise(async (resolve, reject) => {
    if (quota.get() < quota.max)
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
        }, async (error, response, body) => {
            if (error === null) {
                if (body.compositions) {
                    const song = body.compositions[0];
                    console.log(`[AI] Generating '(${song.name})' (${song._id})...`);
                    quota.add();
                    resolve();
                } else {
                    console.warn(body);
                    
                    if(body.result === 0)
                      console.log(`[WARNING] ${body.message}`);
                   
                    reject(body.message);
                }
            } else {
                console.error(error);
                setTimeout(pumpSongs, (60 * 1000) * 60);//Stunde warten
                return reject(error);
            }
        });
    else console.log("[WARNING] Daily quota reached.")
});
//pumpworker
const pumpSongs = () => {
    console.log(`[PUMPER] getting status... (Quota: ${quota.get()}/${quota.max}).`)
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
        console.log("[PUMPER] pumping songs...")
        var i = 0;
        if (json.compositions.length > 0) {
            //Songs löschen
            for (var key in json.compositions) {
                const song = json.compositions[key];
                console.log(`[AI] deleting '${song.name}'...`)
                if (song.isFinished) { //done
                    await get(song);
                    await deleteSong(song);
                    i++;
                    if (i === json.compositions) {
                        console.log("[PUMPER] all available songs have been pumped.");
                    }
                }
            }
        } else await create(); //create new if not existing
        setTimeout(pumpSongs, 999);
    });
};
pumpSongs();