import React, { useState } from 'react';
import { exportApp, importApp, hashFile } from './app_tools';

const AppGenerator = () => {
  const [vrmFile, setVrmFile] = useState(null);
  const [appName, setAppName] = useState('');
  const [importedApp, setImportedApp] = useState(null);
  const [scriptContent, setScriptContent] = useState('');

  const handleExport = async () => {
    if (!vrmFile || !appName) return;

    const resolveFile = async (url) => {
      if (url.startsWith('asset://')) {
        const resp = await fetch('/eliza.js');
        const blob = await resp.blob();
        const file = new File([blob], 'eliza.js', { type: 'application/javascript' });
        return file;
      }
      return vrmFile;
    };

    const blueprint = {
      name: appName,
      model: vrmFile.name,
      script: `asset://${await hashFile(await resolveFile('/eliza.js'))}.js`,
      props: {},
      locked: false
    };

    const file = await exportApp(blueprint, resolveFile);
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file || !file.name.endsWith('.hyp')) return;

    const result = await importApp(file);
    setImportedApp(result);

    // Extract script content if available
    const scriptAsset = result.assets.find(a => a.type === 'script');
    if (scriptAsset) {
      const text = await scriptAsset.file.text();
      setScriptContent(text);
    }
  };

  return (
    <div className="p-4">
      <div className="mb-8">
        <h2 className="text-xl font-bold mb-4">App Generator</h2>
        <div className="space-y-4">
          <div>
            <label className="block mb-2">VRM File:</label>
            <input 
              type="file" 
              accept=".vrm"
              onChange={(e) => setVrmFile(e.target.files[0])} 
              className="border p-2"
            />
          </div>
          <div>
            <label className="block mb-2">App Name:</label>
            <input 
              type="text"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              className="border p-2"
            />
          </div>
          <button 
            onClick={handleExport}
            disabled={!vrmFile || !appName}
            className="bg-blue-500 text-white px-4 py-2 rounded"
          >
            Export App
          </button>
        </div>
      </div>

      <div className="mb-8">
        <h2 className="text-xl font-bold mb-4">App Importer</h2>
        <input 
          type="file"
          accept=".hyp"
          onChange={handleImport}
          className="border p-2"
        />
      </div>

      {importedApp && (
        <div className="mt-4">
          <h3 className="text-lg font-bold mb-2">Imported App Info:</h3>
          <pre className="bg-gray-100 p-4 rounded overflow-auto">
            {JSON.stringify(importedApp.blueprint, null, 2)}
          </pre>
          
          <h3 className="text-lg font-bold mt-4 mb-2">Assets:</h3>
          <ul className="list-disc pl-5">
            {importedApp.assets.map((asset, i) => (
              <li key={i}>
                {asset.type}: {asset.url} ({asset.file.size} bytes)
              </li>
            ))}
          </ul>

          {scriptContent && (
            <>
              <h3 className="text-lg font-bold mt-4 mb-2">Script Content:</h3>
              <pre className="bg-gray-100 p-4 rounded overflow-auto">
                {scriptContent}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default AppGenerator;