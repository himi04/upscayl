import {
  getBatchArguments,
  getBatchSharpenArguments,
  getDoubleUpscaleArguments,
  getDoubleUpscaleSecondPassArguments,
  getSingleImageArguments,
  getSingleImageSharpenArguments,
} from "./utils/getArguments";
// Native
import { autoUpdater } from "electron-updater";
import getPlatform from "./getPlatform";
import ffmpeg from "upscayl-ffmpeg";
import { join, parse } from "path";
import log from "electron-log";
import { format } from "url";
import fs from "fs";

import { execPath, modelsPath } from "./binaries";

// Packages
import {
  BrowserWindow,
  app,
  ipcMain,
  dialog,
  shell,
  MessageBoxOptions,
} from "electron";

import { spawnUpscayl } from "./upscayl";
import prepareNext from "electron-next";
import isDev from "electron-is-dev";
import commands from "./commands";

log.initialize({ preload: true });

// Prepare the renderer once the app is ready
let mainWindow: BrowserWindow;
app.on("ready", async () => {
  await prepareNext("./renderer");

  log.info("🚀 ICON PATH: ", join(__dirname, "build", "icon.png"));
  log.info("🚀 UPSCAYL EXEC PATH: ", execPath(""));
  log.info("🚀 MODELS PATH: ", modelsPath);
  log.info("🚀 FFMPEG PATH: ", ffmpeg.path);

  mainWindow = new BrowserWindow({
    icon: join(__dirname, "build", "icon.png"),
    width: 1300,
    height: 940,
    minHeight: 500,
    minWidth: 500,
    show: false,
    backgroundColor: "#171717",
    webPreferences: {
      nodeIntegration: true,
      webSecurity: false,
      preload: join(__dirname, "preload.js"),
    },
  });
  const url = isDev
    ? "http://localhost:8000"
    : format({
        pathname: join(__dirname, "../renderer/out/index.html"),
        protocol: "file:",
        slashes: true,
      });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(url);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.webContents.setZoomFactor(1);
  });

  if (!isDev) {
    autoUpdater.checkForUpdates();
  }
});

// Quit the app once all windows are closed
app.on("window-all-closed", app.quit);

log.log(app.getAppPath());

// Path variables for file and folder selection
let imagePath: string | undefined = undefined;
let folderPath: string | undefined = undefined;
let customModelsFolderPath: string | undefined = undefined;

// Default models
const defaultModels = [
  "realesrgan-x4plus",
  "remacri",
  "ultramix_balanced",
  "ultrasharp",
  "realesrgan-x4plus-anime",
];

//------------------------Select File-----------------------------//
// ! DONT FORGET TO RESTART THE APP WHEN YOU CHANGE CODE HERE
ipcMain.handle(commands.SELECT_FILE, async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    title: "Select Image",
    defaultPath: imagePath,
  });

  if (canceled) {
    log.log("File Operation Cancelled");
    return null;
  } else {
    log.log("Selected File Path: ", filePaths[0]);
    let isValid = false;
    imagePath = filePaths[0];

    // READ SELECTED FILES
    filePaths.forEach((file) => {
      // log.log("Files in Folder: ", file);
      if (
        file.endsWith(".png") ||
        file.endsWith(".jpg") ||
        file.endsWith(".jpeg") ||
        file.endsWith(".webp") ||
        file.endsWith(".JPG") ||
        file.endsWith(".PNG") ||
        file.endsWith(".JPEG") ||
        file.endsWith(".WEBP")
      ) {
        isValid = true;
      }
    });

    if (!isValid) {
      const options: MessageBoxOptions = {
        type: "error",
        title: "Invalid File",
        message:
          "The selected file is not a valid image. Make sure you select a '.png', '.jpg', or '.webp' file.",
      };
      dialog.showMessageBoxSync(mainWindow, options);
      return null;
    }

    // CREATE input AND upscaled FOLDER
    return filePaths[0];
  }
});

//------------------------Select Folder-----------------------------//
ipcMain.handle(commands.SELECT_FOLDER, async (event, message) => {
  const { canceled, filePaths: folderPaths } = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    defaultPath: folderPath,
  });
  if (canceled) {
    return null;
  } else {
    log.log("Selected Folder Path: ", folderPaths[0]);
    folderPath = folderPaths[0];
    return folderPaths[0];
  }
});

//------------------------Get Model Names-----------------------------//
const getModels = (folderPath: string) => {
  let models: string[] = [];
  let isValid = false;

  // READ CUSTOM MODELS FOLDER
  fs.readdirSync(folderPath).forEach((file) => {
    // log.log("Files in Folder: ", file);
    if (
      file.endsWith(".param") ||
      file.endsWith(".PARAM") ||
      file.endsWith(".bin") ||
      file.endsWith(".BIN")
    ) {
      isValid = true;
      const modelName = file.substring(0, file.lastIndexOf(".")) || file;
      if (!models.includes(modelName)) {
        models.push(modelName);
      }
    }
  });

  if (!isValid) {
    const options: MessageBoxOptions = {
      type: "error",
      title: "Invalid Folder",
      message:
        "The selected folder does not contain valid model files. Make sure you select the folder that ONLY contains '.param' and '.bin' files.",
      buttons: ["OK"],
    };
    dialog.showMessageBoxSync(options);
    return null;
  }

  return models;
};

ipcMain.on(commands.GET_MODELS_LIST, async (event, payload) => {
  if (payload) {
    customModelsFolderPath = payload;
    mainWindow.webContents.send(
      commands.CUSTOM_MODEL_FILES_LIST,
      getModels(payload)
    );
  }
});

//------------------------Select Custom Models Folder---------------------//
ipcMain.handle(commands.SELECT_CUSTOM_MODEL_FOLDER, async (event, message) => {
  const { canceled, filePaths: folderPaths } = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select Custom Models Folder",
    defaultPath: customModelsFolderPath,
  });
  if (canceled) {
    return null;
  } else {
    log.log("Custom Folder Path: ", folderPaths[0]);
    customModelsFolderPath = folderPaths[0];

    mainWindow.webContents.send(
      commands.CUSTOM_MODEL_FILES_LIST,
      getModels(customModelsFolderPath)
    );

    return customModelsFolderPath;
  }
});

//------------------------Open Folder-----------------------------//
ipcMain.on(commands.OPEN_FOLDER, async (event, payload) => {
  log.log(payload);
  shell.openPath(payload);
});

//------------------------Double Upscayl-----------------------------//
ipcMain.on(commands.DOUBLE_UPSCAYL, async (event, payload) => {
  const model = payload.model as string;
  let inputDir = (payload.imagePath.match(/(.*)[\/\\]/)[1] || "") as string;
  let outputDir = payload.outputPath as string;
  const gpuId = payload.gpuId as string;
  const saveImageAs = payload.saveImageAs as string;

  const isDefaultModel = defaultModels.includes(model);

  // COPY IMAGE TO TMP FOLDER
  const platform = getPlatform();
  const fullfileName =
    platform === "win"
      ? (payload.imagePath.split("\\").slice(-1)[0] as string)
      : (payload.imagePath.split("/").slice(-1)[0] as string);
  const fileName = parse(fullfileName).name;
  const fileExt = parse(fullfileName).ext;
  const outFile =
    outputDir + "/" + fileName + "_upscayl_16x_" + model + "." + saveImageAs;

  // UPSCALE
  let upscayl = spawnUpscayl(
    "realesrgan",
    getDoubleUpscaleArguments(
      inputDir,
      fullfileName,
      outFile,
      isDefaultModel ? modelsPath : customModelsFolderPath ?? modelsPath,
      model,
      gpuId,
      saveImageAs
    )
  );

  let failed = false;
  let isAlpha = false;
  let failed2 = false;

  const onData = (data) => {
    // CONVERT DATA TO STRING
    data = data.toString();
    // PRINT TO CONSOLE
    log.log(data);
    // SEND UPSCAYL PROGRESS TO RENDERER
    mainWindow.webContents.send(commands.DOUBLE_UPSCAYL_PROGRESS, data);
    // IF PROGRESS HAS ERROR, UPSCAYL FAILED
    if (data.includes("invalid gpu") || data.includes("failed")) {
      failed = true;
    }
    if (data.includes("has alpha channel")) {
      isAlpha = true;
    }
  };
  const onError = (data) => {
    data.toString();
    // SEND UPSCAYL PROGRESS TO RENDERER
    mainWindow.webContents.send(commands.DOUBLE_UPSCAYL_PROGRESS, data);
    // SET FAILED TO TRUE
    failed = true;
    return;
  };
  const onData2 = (data) => {
    // CONVERT DATA TO STRING
    data = data.toString();
    // PRINT TO CONSOLE
    log.log(data);
    // SEND UPSCAYL PROGRESS TO RENDERER
    mainWindow.webContents.send(commands.DOUBLE_UPSCAYL_PROGRESS, data);
    // IF PROGRESS HAS ERROR, UPSCAYL FAILED
    if (data.includes("invalid gpu") || data.includes("failed")) {
      failed2 = true;
    }
  };
  const onError2 = (data) => {
    data.toString();
    // SEND UPSCAYL PROGRESS TO RENDERER
    mainWindow.webContents.send(commands.DOUBLE_UPSCAYL_PROGRESS, data);
    // SET FAILED TO TRUE
    failed2 = true;
    return;
  };
  const onClose2 = (code) => {
    if (!failed2) {
      log.log("Done upscaling");
      mainWindow.webContents.send(
        commands.DOUBLE_UPSCAYL_DONE,
        isAlpha ? outFile + ".png" : outFile
      );
    }
  };

  upscayl.process.stderr.on("data", onData);
  upscayl.process.on("error", onError);
  upscayl.process.on("close", (code) => {
    // IF NOT FAILED
    if (!failed) {
      // UPSCALE
      let upscayl2 = spawnUpscayl(
        "realesrgan",
        getDoubleUpscaleSecondPassArguments(
          isAlpha,
          outFile,
          isDefaultModel ? modelsPath : customModelsFolderPath ?? modelsPath,
          model,
          gpuId,
          saveImageAs
        )
      );

      upscayl2.process.stderr.on("data", onData2);
      upscayl2.process.on("error", onError2);
      upscayl2.process.on("close", onClose2);
    }
  });
});

//------------------------Image Upscayl-----------------------------//
ipcMain.on(commands.UPSCAYL, async (event, payload) => {
  const model = payload.model as string;
  const scale = payload.scaleFactor;
  const gpuId = payload.gpuId as string;
  const saveImageAs = payload.saveImageAs as string;
  let inputDir = (payload.imagePath.match(/(.*)[\/\\]/)[1] || "") as string;
  let outputDir = payload.outputPath as string;

  const isDefaultModel = defaultModels.includes(model);

  // COPY IMAGE TO TMP FOLDER
  const fullfileName = payload.imagePath.replace(/^.*[\\\/]/, "") as string;

  const fileName = parse(fullfileName).name;
  log.log("🚀 => fileName", fileName);

  const fileExt = parse(fullfileName).ext;
  log.log("🚀 => fileExt", fileExt);

  const outFile =
    outputDir +
    "/" +
    fileName +
    "_upscayl_" +
    scale +
    "x_" +
    model +
    "." +
    saveImageAs;

  // UPSCALE
  if (fs.existsSync(outFile)) {
    // If already upscayled, just output that file
    mainWindow.webContents.send(commands.UPSCAYL_DONE, outFile);
  } else {
    const upscayl = spawnUpscayl(
      "realesrgan",
      getSingleImageArguments(
        inputDir,
        fullfileName,
        outFile,
        isDefaultModel ? modelsPath : customModelsFolderPath ?? modelsPath,
        model,
        scale,
        gpuId,
        saveImageAs
      )
    );

    let isAlpha = false;
    let failed = false;

    const onData = (data: string) => {
      log.log("image upscayl: ", data.toString());
      data = data.toString();
      mainWindow.webContents.send(commands.UPSCAYL_PROGRESS, data.toString());
      if (data.includes("invalid gpu") || data.includes("failed")) {
        failed = true;
      }
      if (data.includes("has alpha channel")) {
        log.log("INCLUDES ALPHA CHANNEL, CHANGING OUTFILE NAME!");
        isAlpha = true;
      }
    };
    const onError = (data) => {
      mainWindow.webContents.send(commands.UPSCAYL_PROGRESS, data.toString());
      failed = true;
      return;
    };
    const onClose = () => {
      if (failed !== true) {
        log.log("Done upscaling");
        mainWindow.webContents.send(
          commands.UPSCAYL_DONE,
          isAlpha ? outFile + ".png" : outFile
        );
      }
    };

    upscayl.process.stderr.on("data", onData);
    upscayl.process.on("error", onError);
    upscayl.process.on("close", onClose);
  }
});

//------------------------Upscayl Folder-----------------------------//
ipcMain.on(commands.FOLDER_UPSCAYL, async (event, payload) => {
  // GET THE MODEL
  const model = payload.model;
  const gpuId = payload.gpuId;
  const saveImageAs = payload.saveImageAs;

  // GET THE IMAGE DIRECTORY
  let inputDir = payload.batchFolderPath;

  // GET THE OUTPUT DIRECTORY
  let outputDir = payload.outputPath;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const isDefaultModel = defaultModels.includes(model);

  // UPSCALE
  const upscayl = spawnUpscayl(
    "realesrgan",
    getBatchArguments(
      inputDir,
      outputDir,
      isDefaultModel ? modelsPath : customModelsFolderPath ?? modelsPath,
      model,
      gpuId,
      saveImageAs
    )
  );

  let failed = false;
  const onData = (data: any) => {
    log.log("🚀 => upscayl.stderr.on => stderr.toString()", data.toString());
    data = data.toString();
    mainWindow.webContents.send(
      commands.FOLDER_UPSCAYL_PROGRESS,
      data.toString()
    );
    if (data.includes("invalid gpu") || data.includes("failed")) {
      failed = true;
    }
  };
  const onError = (data: any) => {
    mainWindow.webContents.send(
      commands.FOLDER_UPSCAYL_PROGRESS,
      data.toString()
    );
    failed = true;
    return;
  };
  const onClose = () => {
    if (failed !== true) {
      log.log("Done upscaling");
      mainWindow.webContents.send(commands.FOLDER_UPSCAYL_DONE, outputDir);
    }
  };

  upscayl.process.stderr.on("data", onData);
  upscayl.process.on("error", onError);
  upscayl.process.on("close", onClose);
});

//------------------------Auto-Update Code-----------------------------//
// ! AUTO UPDATE STUFF
autoUpdater.on("update-available", ({ releaseNotes, releaseName }) => {
  const dialogOpts = {
    type: "info",
    buttons: ["Ok cool"],
    title: "New Upscayl Update",
    message: releaseName as string,
    detail:
      "A new version is being downloaded. Please check GitHub for more details.",
  };
  dialog.showMessageBox(dialogOpts).then((returnValue) => {});
});

autoUpdater.on("update-downloaded", (event) => {
  const dialogOpts: MessageBoxOptions = {
    type: "info",
    buttons: ["Restart", "Later"],
    title: "New Upscayl Update",
    message: event.releaseName as string,
    detail:
      "A new version has been downloaded. Restart the application to apply the updates.",
  };
  dialog.showMessageBox(dialogOpts).then((returnValue) => {
    if (returnValue.response === 0) autoUpdater.quitAndInstall();
  });
});

//------------------------Video Upscayl-----------------------------//
// ipcMain.on(commands.UPSCAYL_VIDEO, async (event, payload) => {
//   // Extract the model
//   const model = payload.model;

//   // Extract the Video Directory
//   let videoFileName = payload.videoPath.replace(/^.*[\\\/]/, "");
//   const justFileName = parse(videoFileName).name;

//   let inputDir = payload.videoPath.match(/(.*)[\/\\]/)[1] || "";
//   log.log("🚀 => file: index.ts => line 337 => inputDir", inputDir);

//   // Set the output directory
//   let outputDir = payload.outputPath + "_frames";
//   log.log("🚀 => file: index.ts => line 340 => outputDir", outputDir);

//   let frameExtractionPath = join(inputDir, justFileName + "_f");
//   let frameUpscalePath = join(inputDir, justFileName + "_u");
//   log.log(
//     "🚀 => file: index.ts => line 342 => frameExtractionPath",
//     frameExtractionPath,
//     frameUpscalePath
//   );

//   if (!fs.existsSync(frameExtractionPath)) {
//     fs.mkdirSync(frameExtractionPath, { recursive: true });
//   }
//   if (!fs.existsSync(frameUpscalePath)) {
//     fs.mkdirSync(frameUpscalePath, { recursive: true });
//   }

//   let ffmpegProcess: ChildProcessWithoutNullStreams | null = null;
//   ffmpegProcess = spawn(
//     ffmpeg.path,
//     [
//       "-i",
//       inputDir + "/" + videoFileName,
//       frameExtractionPath + "/" + "out%d.png",
//     ],
//     {
//       cwd: undefined,
//       detached: false,
//     }
//   );

//   let failed = false;
//   ffmpegProcess?.stderr.on("data", (data: string) => {
//     log.log("🚀 => file: index.ts:420 => data", data.toString());
//     data = data.toString();
//     mainWindow.webContents.send(
//       commands.FFMPEG_VIDEO_PROGRESS,
//       data.toString()
//     );
//   });

//   ffmpegProcess?.on("error", (data: string) => {
//     mainWindow.webContents.send(
//       commands.FFMPEG_VIDEO_PROGRESS,
//       data.toString()
//     );
//     failed = true;
//     return;
//   });

//   // Send done comamnd when
//   ffmpegProcess?.on("close", (code: number) => {
//     if (failed !== true) {
//       log.log("Frame extraction successful!");
//       mainWindow.webContents.send(commands.FFMPEG_VIDEO_DONE, outputDir);

//       // UPSCALE
//       let upscayl: ChildProcessWithoutNullStreams | null = null;
//       upscayl = spawn(
//         execPath("realesrgan"),
//         [
//           "-i",
//           frameExtractionPath,
//           "-o",
//           frameUpscalePath,
//           "-s",
//           4,
//           "-m",
//           modelsPath,
//           "-n",
//           model,
//         ],
//         {
//           cwd: undefined,
//           detached: false,
//         }
//       );

//       upscayl?.stderr.on("data", (data) => {
//         log.log(
//           "🚀 => upscayl.stderr.on => stderr.toString()",
//           data.toString()
//         );
//         data = data.toString();
//         mainWindow.webContents.send(
//           commands.FFMPEG_VIDEO_PROGRESS,
//           data.toString()
//         );
//       });
//     }
//   });
// });
