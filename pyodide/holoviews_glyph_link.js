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

import numpy as np

import panel as pn



import holoviews as hv

import holoviews.plotting.bokeh



pn.extension()

pn.pane.Markdown('\\nHoloViews-generated Bokeh plots can be statically linked to widgets that control their properties, allowing you to export static HTML files that allow end-user customization of appearance.\\n\\n').servable()

from bokeh.core.enums import MarkerType



colors = ["black", "red", "blue", "green", "gray"]

markers = list(MarkerType)



# Define widget for properties we want to change

alpha_widget = pn.widgets.FloatSlider(value=0.5, start=0, end=1, name='Alpha')

size_widget = pn.widgets.FloatSlider(value=12, start=3, end=20, name='Size')

color_widget = pn.widgets.ColorPicker(value='#f80000', name='Color')

marker_widget = pn.widgets.Select(options=markers, value='circle', name='Marker')



# Declare a Points object and apply some options

points = hv.Points(np.random.randn(200, 2)).options(

    padding=0.1, height=500, line_color='black', responsive=True)



# Link the widget value parameter to the property on the glyph

alpha_widget.jslink(points, value='glyph.fill_alpha')

size_widget.jslink(points, value='glyph.size')

color_widget.jslink(points, value='glyph.fill_color')

marker_widget.jslink(points, value='glyph.marker')



pn.Row(pn.Column(alpha_widget, color_widget, marker_widget, size_widget), points).servable()


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