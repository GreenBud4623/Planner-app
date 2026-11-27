package app.planner.local;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-only plugin: lets the web app send the home-screen widget its summary
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
