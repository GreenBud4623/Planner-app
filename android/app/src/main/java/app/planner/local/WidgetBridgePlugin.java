package app.planner.local;

import android.content.Context;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Receives the widget summary from www/app.js (a small JSON text, see pushWidget there),
 * stores it on the phone and redraws every Planner widget on the home screen.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {
    static final String PREFS = "planner_widget";
    static final String KEY = "summary";
    private static final int MAX_LENGTH = 64 * 1024;

    @PluginMethod
    public void update(PluginCall call) {
        String data = call.getString("data");
        if (data == null || data.length() > MAX_LENGTH) {
            call.reject("Missing or too large widget data");
            return;
        }
        Context context = getContext();
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, data).apply();
        PlannerWidget.updateAll(context);
        call.resolve();
    }
}
