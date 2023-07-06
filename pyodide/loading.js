importScripts("https://cdn.jsdelivr.net/pyodide/v0.23.0/full/pyodide.js");

function sendPatch(patch, buffers, msg_id) {
  self.postMessage({
    type: 'patch',
    patch: patch,
    buffers: buffers
  })
}

async function startApplication() {
  console.log("Loading pyodide!");
  self.postMessage({type: 'status', msg: 'Loading pyodide'})
  self.pyodide = await loadPyodide();
  self.pyodide.globals.set("sendPatch", sendPatch);
  console.log("Loaded!");
  await self.pyodide.loadPackage("micropip");
  const env_spec = ['https://cdn.holoviz.org/panel/1.2.0/dist/wheels/bokeh-3.2.0-py3-none-any.whl', 'https://cdn.holoviz.org/panel/1.2.0/dist/wheels/panel-1.2.0-py3-none-any.whl', 'pyodide-http==0.2.1', 'holoviews']
  for (const pkg of env_spec) {
    let pkg_name;
    if (pkg.endsWith('.whl')) {
      pkg_name = pkg.split('/').slice(-1)[0].split('-')[0]
    } else {
      pkg_name = pkg
    }
    self.postMessage({type: 'status', msg: `Installing ${pkg_name}`})
    try {
      await self.pyodide.runPythonAsync(`
        import micropip
        await micropip.install('${pkg}');
      `);
    } catch(e) {
      console.log(e)
      self.postMessage({
	type: 'status',
	msg: `Error while installing ${pkg_name}`
      });
    }
  }
  console.log("Packages loaded!");
  self.postMessage({type: 'status', msg: 'Executing code'})
  const code = `
  
import asyncio

from panel.io.pyodide import init_doc, write_doc

init_doc()

import time

import panel as pn

import holoviews as hv

import numpy as np

import holoviews.plotting.bokeh



pn.extension(loading_spinner='dots', loading_color='#00aa41', template='bootstrap')

hv.extension('bokeh')

pn.pane.Markdown('\\nEvery pane, widget and layout provides the **\`loading\` parameter**. When set to \`True\` a spinner will overlay the panel and indicate that the panel is currently loading. When you set \`loading\` to false the spinner is removed.\\n\\nUsing the \`pn.extension\` or by setting the equivalent parameters on \`pn.config\` we can select between different visual styles and colors for the loading indicator.\\n\\n').servable()

pn.extension(loading_spinner='dots', loading_color='#00aa41')

pn.pane.Markdown('\\nWe can enable the loading indicator for reactive functions annotated with \`depends\` or \`bind\` globally using:\\n\\n').servable()

pn.param.ParamMethod.loading_indicator = True

pn.pane.Markdown('\\nAlternatively we can enable it for a specific function by passing the \`loading_indicator=True\` argument to \`pn.panel\` or directly to the underlying  \`ParamMethod\`/\`ParamFunction\` object:\\n\\n').servable()

button = pn.widgets.Button(name="UPDATE", button_type="primary", sizing_mode='stretch_width')



def random_plot(event):

    if event: time.sleep(5)

    return hv.Points(np.random.rand(100, 2)).opts(

        responsive=True, height=400, size=8, color="green")



pn.Column(

    button,

    pn.param.ParamFunction(pn.bind(random_plot, button), loading_indicator=True)

).servable()

pn.state.template.title = 'Loading Indicator'

await write_doc()
  `

  try {
    const [docs_json, render_items, root_ids] = await self.pyodide.runPythonAsync(code)
    self.postMessage({
      type: 'render',
      docs_json: docs_json,
      render_items: render_items,
      root_ids: root_ids
    })
  } catch(e) {
    const traceback = `${e}`
    const tblines = traceback.split('\n')
    self.postMessage({
      type: 'status',
      msg: tblines[tblines.length-2]
    });
    throw e
  }
}

self.onmessage = async (event) => {
  const msg = event.data
  if (msg.type === 'rendered') {
    self.pyodide.runPythonAsync(`
    from panel.io.state import state
    from panel.io.pyodide import _link_docs_worker

    _link_docs_worker(state.curdoc, sendPatch, setter='js')
    `)
  } else if (msg.type === 'patch') {
    self.pyodide.globals.set('patch', msg.patch)
    self.pyodide.runPythonAsync(`
    state.curdoc.apply_json_patch(patch.to_py(), setter='js')
    `)
    self.postMessage({type: 'idle'})
  } else if (msg.type === 'location') {
    self.pyodide.globals.set('location', msg.location)
    self.pyodide.runPythonAsync(`
    import json
    from panel.io.state import state
    from panel.util import edit_readonly
    if state.location:
        loc_data = json.loads(location)
        with edit_readonly(state.location):
            state.location.param.update({
                k: v for k, v in loc_data.items() if k in state.location.param
            })
    `)
  }
}

startApplication()